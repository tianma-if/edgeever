import { BlobReader, ZipReader, type Entry } from "@zip.js/zip.js/index-native.js";
import { extract } from "it-tar";
import type { ImportFile, ImportIndex, ImportIssue, SourceEntry } from "./types";
import { IMPORT_CHUNK_BYTES } from "./types";

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
export const addIssue = async (index: ImportIndex, code: string, path: string, severity: ImportIssue["severity"] = "error", detail?: string) => {
  const key = crypto.randomUUID();
  await index.put("issue", key, { key, code, path, severity, ...(detail ? { detail } : {}) });
};

export class ImportSources {
  private zips = new Map<number, { reader: ZipReader<Blob>; entries: Map<string, Entry> }>();
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
  async scan(signal?: AbortSignal, progress?: (path: string) => void) {
    for (const [fileIndex, input] of this.files.entries()) {
      signal?.throwIfAborted();
      progress?.(input.path);
      if (input.expandArchive !== false && /\.zip$/i.test(input.path)) {
        const reader = new ZipReader(new BlobReader(input.file), { useWebWorkers: false });
        const entries = new Map<string, Entry>();
        this.zips.set(fileIndex, { reader, entries });
        let root: string | undefined;
        for await (const entry of reader.getEntriesGenerator()) {
          signal?.throwIfAborted();
          if (entry.directory) continue;
          if (entry.unixMode && (entry.unixMode & 0xf000) === 0xa000) { await addIssue(this.index, "symlink", entry.filename); continue; }
          entries.set(entry.filename, entry);
          const path = await this.add({ key: entry.filename, path: entry.filename, size: entry.uncompressedSize, fileIndex, archivePath: entry.filename });
          if (path) {
            const top = path.includes("/") ? path.split("/")[0]! : "";
            root = root === undefined ? top : root === top ? root : "";
          }
        }
        this.zipRoots.set(fileIndex, root ?? "");
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
      let output!: TransformStreamDefaultController<Uint8Array>;
      const stream = new TransformStream<Uint8Array, Uint8Array>({ start(controller) { output = controller; } });
      const abort = () => output.error(signal!.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const writing = found.getData(stream.writable, { signal }).then(() => ({ error: null as unknown })).catch(error => { output.error(error); return { error }; });
      const reader = stream.readable.getReader();
      try {
        while (true) {
          signal?.throwIfAborted();
          const next = await reader.read();
          if (next.done) break;
          // Normalize buffers at the worker/Blob boundary.
          yield new Uint8Array(next.value);
        }
        const result = await writing;
        if (result.error) throw result.error;
      } finally { signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); await writing; }
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
