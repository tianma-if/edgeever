import { BlobReader, Reader, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js/index-native.js";
import { extract } from "it-tar";
import type { ImportFile, ImportIndex, ImportIssue, SourceEntry } from "./types";
import { IMPORT_CHUNK_BYTES } from "./types";
import { ImportByteStore } from "./byte-store";

export const basename = (path: string) => path.split("/").at(-1) ?? path;
export const dirname = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const stem = (path: string) => basename(path).replace(/\.[^.]+$/, "");
export const normalPath = (path: string) => {
  if (/^(?:[a-z]:|[\\/])/i.test(path) || path.includes("\0")) throw new Error("outsideRoot");
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("outsideRoot"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
};
const ignored = (path: string) => path.split("/").some(part => [".obsidian", ".git", ".trash", "__MACOSX", ".DS_Store", "Thumbs.db"].includes(part));
const notionPartZip = /^Export(?:Block)?-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-Part-[1-9]\d*\.zip$/i;
export const addIssue = async (index: ImportIndex, code: string, path: string, severity: ImportIssue["severity"] = "error", detail?: string) => {
  // Index pages are key-ordered: show blocking errors before paginating warnings.
  const key = `${severity === "error" ? "0" : "1"}-${crypto.randomUUID()}`;
  await index.put("issue", key, { key, code, path, severity, ...(detail ? { detail } : {}) });
};

async function* zipEntryBytes(entry: FileEntry, signal?: AbortSignal, checkSignature = false): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  let output!: TransformStreamDefaultController<Uint8Array>;
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start(controller) { output = controller; } });
  const abort = () => output.error(signal!.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const writing = entry.getData(stream.writable, { signal, checkSignature })
    .then(() => ({ error: null as unknown }))
    .catch(error => { output.error(error); return { error }; });
  const reader = stream.readable.getReader();
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      yield new Uint8Array(next.value);
    }
    const result = await writing;
    if (result.error) throw result.error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await writing;
  }
}

class StagedZipReader extends Reader<null> {
  constructor(private bytes: ImportByteStore, size: number) {
    super(null);
    this.size = size;
  }
  override readUint8Array(offset: number, length: number) {
    return this.bytes.read(offset, Math.max(offset, Math.min(offset + length, this.size)));
  }
}

export class ImportSources {
  private zips = new Map<number, { reader: ZipReader<unknown>; entries: Map<string, Entry> }>();
  private zipRoots = new Map<number, string>();
  constructor(private files: ImportFile[], private index: ImportIndex) {}
  private async add(entry: SourceEntry) {
    let path: string;
    try { path = normalPath(entry.path); } catch { await addIssue(this.index, "outsideRoot", entry.path); return; }
    if (!path) return;
    // A Vault's configuration locates its root without importing config files.
    if (ignored(path)) return path.split("/").includes(".obsidian") ? path : undefined;
    if (await this.index.get("entry", path)) { await addIssue(this.index, "duplicatePath", path); return; }
    entry = { ...entry, key: path, path };
    await this.index.put("entry", path, entry);
    const name = basename(path);
    const aliases = await this.index.get<string[]>("alias", name) ?? [];
    await this.index.put("alias", name, [...aliases, path]);
    const id = /^([0-9a-f]{32})(?:\.[^.]+)?$/i.exec(name)?.[1];
    if (id && (!/\.md$/i.test(name) || /(?:^|\/)_?resources\//i.test(path))) await this.index.put("rawBinary", id, entry);
    return path;
  }
  archiveRoot(entry: SourceEntry) { return this.zipRoots.get(entry.fileIndex) ?? ""; }
  private async scanZip(input: Reader<unknown>, fileIndex: number, signal?: AbortSignal, expandNotionParts = false) {
    const reader = new ZipReader(input, { useWebWorkers: false });
    const entries = new Map<string, Entry>();
    this.zips.set(fileIndex, { reader, entries });
    const partNames = new Set<string>();
    let root: string | undefined;
    for await (const entry of reader.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (entry.directory) continue;
      if (entry.unixMode && (entry.unixMode & 0xf000) === 0xa000) { await addIssue(this.index, "symlink", entry.filename); continue; }
      if (expandNotionParts && notionPartZip.test(entry.filename)) {
        if (partNames.has(entry.filename)) {
          await addIssue(this.index, "duplicatePath", entry.filename);
          continue;
        }
        partNames.add(entry.filename);
        try {
          const partIndex = this.files.length + this.zips.size;
          const bytes = new ImportByteStore(this.index, "archiveChunk", String(partIndex), 1024 * 1024);
          const size = await bytes.stage(zipEntryBytes(entry, signal, true));
          // Read each part by range, while sharing the original path index.
          await this.scanZip(new StagedZipReader(bytes, size), partIndex, signal);
        } catch (error) {
          signal?.throwIfAborted();
          await addIssue(this.index, "invalidArchive", entry.filename, "error", error instanceof Error ? error.message : String(error));
        }
        continue;
      }
      entries.set(entry.filename, entry);
      const path = await this.add({ key: entry.filename, path: entry.filename, size: entry.uncompressedSize, fileIndex, archivePath: entry.filename });
      if (path) {
        const top = path.includes("/") ? path.split("/")[0]! : "";
        root = root === undefined ? top : root === top ? root : "";
      }
    }
    this.zipRoots.set(fileIndex, root ?? "");
  }
  async scan(signal?: AbortSignal, progress?: (path: string) => void, expandNotionParts = false) {
    for (const [fileIndex, input] of this.files.entries()) {
      signal?.throwIfAborted();
      progress?.(input.path);
      if (input.expandArchive !== false && /\.zip$/i.test(input.path)) {
        await this.scanZip(new BlobReader(input.file), fileIndex, signal, expandNotionParts);
      } else if (input.expandArchive !== false && /\.jex$/i.test(input.path)) {
        // Feed 512-byte records until it-tar has decoded the header and
        // prefetched its first 512 payload bytes. Then drain the body in large,
        // record-aligned chunks. The cursor gives a lazy Blob range without
        // duplicating the codec or spooling the entire JEX to disk.
        let cursor = 0;
        let chunkSize = 512;
        let boundary = input.file.size;
        const source = async function* () {
          while (cursor < input.file.size) {
            signal?.throwIfAborted();
            const end = Math.min(input.file.size, cursor + chunkSize, boundary);
            if (end <= cursor) throw new Error("invalidArchive");
            const bytes = new Uint8Array(await input.file.slice(cursor, end).arrayBuffer());
            cursor = end;
            yield bytes;
          }
        };
        for await (const entry of extract({ highWaterMark: 512 })(source())) {
          const size = entry.header.size ?? 0;
          const offset = size > 0 ? cursor - 512 : cursor;
          chunkSize = 1024 * 1024;
          boundary = offset + Math.ceil(size / 512) * 512;
          let received = 0;
          for await (const chunk of entry.body) received += chunk.length;
          if (received !== size) throw new Error("invalidArchive");
          chunkSize = 512;
          boundary = input.file.size;
          if (entry.header.type === "directory") continue;
          if (entry.header.type !== "file") { await addIssue(this.index, "symlink", entry.header.name); continue; }
          await this.add({ key: entry.header.name, path: entry.header.name, size, fileIndex, offset });
        }
      } else await this.add({ key: input.path, path: input.path, size: input.file.size, fileIndex });
    }
  }
  async *bytes(entry: SourceEntry, signal?: AbortSignal): AsyncGenerator<Uint8Array<ArrayBuffer>> {
    signal?.throwIfAborted();
    if (entry.archivePath !== undefined) {
      const found = this.zips.get(entry.fileIndex)?.entries.get(entry.archivePath);
      if (!found || found.directory) throw new Error("missingResource");
      yield* zipEntryBytes(found, signal);
    } else {
      const file = this.files[entry.fileIndex]!.file;
      for (let start = 0; start < entry.size; start += IMPORT_CHUNK_BYTES) {
        signal?.throwIfAborted();
        const offset = entry.offset ?? 0;
        yield new Uint8Array(await file.slice(offset + start, offset + Math.min(entry.size, start + IMPORT_CHUNK_BYTES)).arrayBuffer());
      }
    }
  }
  async text(entry: SourceEntry, signal?: AbortSignal) {
    const decoder = new TextDecoder();
    const parts: string[] = [];
    for await (const bytes of this.bytes(entry, signal)) parts.push(decoder.decode(bytes, { stream: true }));
    parts.push(decoder.decode());
    return parts.join("").replace(/^\uFEFF/, "");
  }
  async close() { await Promise.all([...this.zips.values()].map(zip => zip.reader.close())); this.zips.clear(); this.zipRoots.clear(); }
}
