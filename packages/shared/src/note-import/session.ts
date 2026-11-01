import type { ImportDocument, ImportFile, ImportFormat, ImportIndex, ImportIssue, ImportNote, ImportNotebook, ImportReference, ImportResource, ImportSummary, SourceEntry } from "./types";
import { IMPORT_CHUNK_BYTES } from "./types";
import { indexItems } from "./index-store";
import { addIssue, basename, dirname, ImportSources, normalPath, stem } from "./sources";
import { importTime, mimeFromName, readMarkdownMetadata, prepareImportNote } from "./metadata";
import { findImportReferences } from "./references";
import { readEnex, type EnexNote } from "./evernote";

type RawItem = { key: string; entryKey: string; title: string; props: Record<string, string> };
const readRaw = (text: string) => {
  const marker = /(?:^|\r?\n\r?\n)(?=id: [a-f0-9]{32}\r?\n)/ig;
  const matches = [...text.matchAll(marker)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return;
  const props: Record<string, string> = {};
  for (const line of text.slice(last.index + last[0].length).trimEnd().split(/\r?\n/)) {
    const match = /^([a-z_]+): ?(.*)$/.exec(line);
    if (!match) return;
    props[match[1]!] = match[2]!;
  }
  if (!/^[0-9a-f]{32}$/i.test(props.id ?? "") || !/^\d+$/.test(props.type_ ?? "")) return;
  const content = text.slice(0, last.index);
  const firstLine = content.indexOf("\n");
  return { props, title: (firstLine === -1 ? content : content.slice(0, firstLine)).trim(), body: firstLine === -1 ? "" : content.slice(firstLine + 1).replace(/^\r?\n/, "") };
};

export class NoteImportSession {
  readonly id: string;
  readonly sources: ImportSources;
  private enexReaders = new Map<string, { iterator: AsyncGenerator<EnexNote>; ordinal: number }>();
  private prepared?: ImportDocument;
  private staged = new Set<string>();
  private nextNote = 0;
  constructor(readonly format: ImportFormat, files: ImportFile[], readonly index: ImportIndex, id: string = crypto.randomUUID()) {
    this.id = id;
    this.sources = new ImportSources(files, index);
  }
  private async notebook(path: string) {
    path ||= this.format === "obsidian" ? "Obsidian" : "Joplin";
    let current = "";
    for (const name of path.split("/")) {
      const parent = current;
      current = parent ? `${parent}/${name}` : name;
      if (!await this.index.get("notebook", current)) {
        await this.index.put<ImportNotebook>("notebook", current, { key: current, name, parentKey: parent || null });
        if (!name.trim() || name.length > 80) await addIssue(this.index, "notebookName", current);
      }
    }
    return path;
  }
  private async saveNote(note: ImportNote) {
    note.key = `note-${String(this.nextNote++).padStart(12, "0")}`;
    await prepareImportNote(this.index, note);
    await this.index.put("note", note.key, note);
    await this.index.put("alias", `note:${note.entryKey}`, note.key);
  }
  private async rawBinaryId(entry: SourceEntry) {
    const id = /^([0-9a-f]{32})(?:\.[^.]+)?$/i.exec(basename(entry.path))?.[1];
    return id && (await this.index.get<SourceEntry>("rawBinary", id))?.key === entry.key ? id : undefined;
  }
  private async isRawPayload(entry: SourceEntry) {
    const id = await this.rawBinaryId(entry);
    const descriptor = id ? await this.index.get<RawItem>("raw", id) : undefined;
    return descriptor?.props.type_ === "4" && descriptor.entryKey !== entry.key;
  }
  private async indexRaw(entry: SourceEntry, signal?: AbortSignal) {
    const raw = readRaw(await this.sources.text(entry, signal));
    if (raw) {
      await this.index.put<RawItem>("raw", raw.props.id!, { key: raw.props.id!, entryKey: entry.key, title: raw.title, props: raw.props });
      await this.index.put("alias", `raw:${entry.key}`, true);
    }
  }
  async scan(signal?: AbortSignal, progress?: (path: string) => void): Promise<ImportSummary> {
    try {
      await this.sources.scan(signal, progress);
      for await (const entry of indexItems<SourceEntry>(this.index, "entry")) {
        signal?.throwIfAborted(); progress?.(entry.path);
        if (this.format === "evernote") {
          if (/\.notes$/i.test(entry.path)) { await addIssue(this.index, "notesFormat", entry.path); continue; }
          if (!/\.enex$/i.test(entry.path)) continue;
          const notebookKey = await this.notebook(entry.path.replace(/\.enex$/i, ""));
          try {
            for await (const raw of readEnex(this.sources.bytes(entry, signal), entry.key)) {
              const resources = raw.resources.filter((res, i, all) => all.findIndex(other => other.hash === res.hash) === i);
              const note: ImportNote = { key: "", path: `${entry.path} / ${raw.title}`, notebookKey, title: raw.title.trim() || stem(entry.path), tags: [...new Set(raw.tags.filter(Boolean))], createdAt: importTime(raw.created), updatedAt: importTime(raw.updated), resources, entryKey: entry.key, ordinal: raw.ordinal };
              for (const match of raw.content.matchAll(/<en-media\b[^>]*\bhash=["']([^"']+)["']/g)) if (!resources.some(res => res.hash === match[1])) await addIssue(this.index, "missingResource", note.path, "error", match[1]);
              await this.saveNote(note);
            }
          } catch (error) { signal?.throwIfAborted(); await addIssue(this.index, "invalidEnex", entry.path, "error", String(error)); }
        } else if (/\.(?:md|markdown)$/i.test(entry.path)) {
          if (this.format === "joplin") {
            if (!await this.rawBinaryId(entry)) await this.indexRaw(entry, signal);
          } else {
            const markdown = await this.sources.text(entry, signal);
            const meta = await readMarkdownMetadata(markdown, stem(entry.path), this.index, entry.path);
            const note: ImportNote = { key: "", path: entry.path, entryKey: entry.key, notebookKey: await this.notebook(dirname(entry.path)), resources: [], ...meta };
            await this.saveNote(note);
          }
        }
      }
      if (this.format === "joplin") {
        // Resource-folder Markdown may be an attachment, a renamed RAW record,
        // or an ordinary note. Read it only after other RAW records identify payloads.
        for await (const entry of indexItems<SourceEntry>(this.index, "entry")) {
          signal?.throwIfAborted();
          if (/\.(?:md|markdown)$/i.test(entry.path) && await this.rawBinaryId(entry) && !await this.isRawPayload(entry)) await this.indexRaw(entry, signal);
        }
        await this.scanRaw(signal);
        for await (const entry of indexItems<SourceEntry>(this.index, "entry")) {
          signal?.throwIfAborted();
          if (!/\.(?:md|markdown)$/i.test(entry.path)) continue;
          if (await this.index.get("alias", `raw:${entry.key}`) || await this.isRawPayload(entry)) continue;
          const markdown = await this.sources.text(entry, signal);
          const meta = await readMarkdownMetadata(markdown, stem(entry.path), this.index, entry.path);
          await this.saveNote({ key: "", path: entry.path, entryKey: entry.key, notebookKey: await this.notebook(dirname(entry.path)), resources: [], ...meta });
        }
      }
      if (this.format !== "evernote") {
        for await (const note of indexItems<ImportNote>(this.index, "note")) {
          signal?.throwIfAborted();
          const doc = await this.readNote(note.key, signal);
          const refs = findImportReferences(doc.contentMarkdown);
          const resources = new Map<string, ImportResource>();
          for (const ref of refs) {
            const resource = await this.resolveReference(note, ref);
            if (resource) {
              ref.resourceKey = resource.key; resources.set(resource.key, resource);
              if (ref.wiki && !resource.mimeType.startsWith("image/")) {
                ref.image = false;
                if (ref.label === ref.href) ref.label = resource.filename;
              }
            }
          }
          note.resources = [...resources.values()]; note.references = refs;
          // Validate resources here; metadata was validated before reference resolution.
          for (const resource of note.resources) {
            const max = resource.mimeType.startsWith("image/") ? 100 * 1024 * 1024 : 1024 * 1024 * 1024;
            if (resource.byteSize <= 0 || resource.byteSize > max) await addIssue(this.index, "resourceSize", note.path, "error", resource.filename);
            await this.index.put("alias", `used:${resource.entryKey}`, true);
          }
          await this.index.put("note", note.key, note);
        }
      }
      if (!await this.index.count("note")) await addIssue(this.index, "noNotes", "");
      if (this.format !== "evernote") for await (const entry of indexItems<SourceEntry>(this.index, "entry")) {
        if (!/\.(?:md|markdown)$/i.test(entry.path) && !await this.index.get("alias", `used:${entry.key}`)) await addIssue(this.index, "unusedResource", entry.path, "warning");
      }
    } catch (error) {
      signal?.throwIfAborted();
      await addIssue(this.index, "invalidArchive", "", "error", error instanceof Error ? error.message : String(error));
    }
    let resources = 0, errors = 0, warnings = 0;
    for await (const note of indexItems<ImportNote>(this.index, "note")) resources += note.resources.length;
    for await (const issue of indexItems<ImportIssue>(this.index, "issue")) {
      if (issue.severity === "error") errors++;
      else warnings++;
    }
    return { id: this.id, format: this.format, notes: await this.index.count("note"), notebooks: await this.index.count("notebook"), resources, errors, warnings };
  }
  private async rawFolder(id: string) {
    if (!id) return this.notebook("");
    const chain: RawItem[] = [];
    const visited = new Set<string>();
    while (id) {
      if (visited.has(id)) throw new Error("cyclicNotebook");
      visited.add(id);
      const item = await this.index.get<RawItem>("raw", id);
      // Selected-note/subtree exports retain IDs of excluded ancestors.
      if (!item) break;
      if (item.props.type_ !== "2") throw new Error("missingNotebook");
      chain.push(item); id = item.props.parent_id ?? "";
    }
    let parentKey: string | null = null;
    for (const item of chain.reverse()) {
      // Hierarchical ID keys preserve distinct names and parent-first pagination.
      const key: string = parentKey ? `${parentKey}/${item.key}` : `joplin:${item.key}`;
      if (!await this.index.get("notebook", key)) {
        await this.index.put<ImportNotebook>("notebook", key, { key, name: item.title, parentKey });
        if (!item.title.trim() || item.title.length > 80) await addIssue(this.index, "notebookName", item.title);
      }
      parentKey = key;
    }
    return parentKey ?? this.notebook("");
  }
  private async scanRaw(signal?: AbortSignal) {
    for await (const item of indexItems<RawItem>(this.index, "raw")) {
      signal?.throwIfAborted();
      if (item.props.type_ === "6") {
        const tag = await this.index.get<RawItem>("raw", item.props.tag_id!);
        if (!tag) { await addIssue(this.index, "missingTag", item.entryKey); continue; }
        const tags = await this.index.get<string[]>("rawTag", item.props.note_id!) ?? [];
        await this.index.put("rawTag", item.props.note_id!, [...tags, tag.title]);
      }
    }
    for await (const item of indexItems<RawItem>(this.index, "raw")) {
      signal?.throwIfAborted();
      try {
        if (item.props.type_ === "2") await this.rawFolder(item.key);
        if (item.props.type_ !== "1") continue;
        const note: ImportNote = {
          key: "", path: item.title || item.entryKey, entryKey: item.entryKey,
          notebookKey: await this.rawFolder(item.props.parent_id ?? ""), title: item.title,
          tags: await this.index.get<string[]>("rawTag", item.key) ?? [],
          createdAt: importTime(item.props.user_created_time || item.props.created_time),
          updatedAt: importTime(item.props.user_updated_time || item.props.updated_time),
          resources: [], raw: true,
        };
        await this.saveNote(note);
      } catch (error) { await addIssue(this.index, "invalidJoplin", item.entryKey, "error", String(error)); }
    }
  }
  private async resolveReference(note: ImportNote, ref: ImportReference): Promise<ImportResource | undefined> {
    let href = ref.href;
    if (/^(?:https?:|mailto:|tel:|data:|#|\/\/)/i.test(href)) return;
    // Keep file/drive forms in local-path validation; other URI targets are not opened.
    if (!ref.wiki && /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(?:file:|[a-z]:)/i.test(href)) return;
    if (this.format === "joplin" && /^:\/[0-9a-f]{32}/i.test(href)) {
      const suffixAt = ref.wiki ? href.indexOf("#") : href.search(/[?#]/);
      ref.suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
      const id = href.slice(2, suffixAt === -1 ? undefined : suffixAt);
      const item = await this.index.get<RawItem>("raw", id);
      if (item?.props.type_ === "1") { await addIssue(this.index, "noteLink", note.path, "warning", href); return; }
      const binary = await this.index.get<SourceEntry>("rawBinary", id);
      if (!binary) { await addIssue(this.index, "missingResource", note.path, "error", href); return; }
      return { key: binary.key, entryKey: binary.key, filename: item?.title || basename(binary.path), mimeType: item?.props.mime || mimeFromName(binary.path), byteSize: binary.size };
    }
    try {
      const suffixAt = ref.wiki ? href.indexOf("#") : href.search(/[?#]/);
      ref.suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
      href = suffixAt === -1 ? href : href.slice(0, suffixAt);
      if (!ref.wiki) href = decodeURIComponent(href.replace(/%(?![0-9a-f]{2})/ig, "%25"));
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) throw new Error("outsideRoot");
      const relative = normalPath(href.startsWith("/") ? href.slice(1) : [dirname(note.entryKey), href].filter(Boolean).join("/"));
      const explicitRelative = /^\.\.?\//.test(href);
      const source = this.format === "obsidian" ? await this.index.get<SourceEntry>("entry", note.entryKey) : undefined;
      const prefix = source ? this.sources.archiveRoot(source) : "";
      const root = !explicitRelative && (ref.wiki || this.format === "obsidian") ? normalPath([prefix, href.replace(/^\//, "")].filter(Boolean).join("/")) : undefined;
      const rootFirst = this.format === "obsidian" && !explicitRelative && href.includes("/");
      let entry = await this.index.get<SourceEntry>("entry", rootFirst ? root! : relative);
      if (!entry && root) entry = await this.index.get<SourceEntry>("entry", rootFirst ? relative : root);
      if (!entry && ref.wiki && !href.includes("/")) {
        const candidates = await this.index.get<string[]>("alias", href) ?? [];
        if (candidates.length > 1) { await addIssue(this.index, "ambiguousResource", note.path, "error", href); return; }
        if (candidates[0]) entry = await this.index.get<SourceEntry>("entry", candidates[0]);
      }
      if (!entry && ref.wiki && !/\.[^/]+$/.test(href)) {
        await addIssue(this.index, "noteLink", note.path, "warning", href); return;
      }
      if (!entry && /\.(?:md|markdown)$/i.test(href)) { await addIssue(this.index, "noteLink", note.path, "warning", href); return; }
      if (!entry) { await addIssue(this.index, "missingResource", note.path, "error", ref.href); return; }
      if (await this.index.get("alias", `note:${entry.key}`)) { await addIssue(this.index, "noteLink", note.path, "warning", href); return; }
      return { key: entry.key, entryKey: entry.key, filename: basename(entry.path), mimeType: mimeFromName(entry.path), byteSize: entry.size };
    } catch { await addIssue(this.index, "outsideRoot", note.path, "error", ref.href); }
  }
  async readNote(key: string, signal?: AbortSignal): Promise<ImportDocument> {
    signal?.throwIfAborted();
    if (this.prepared?.note.key === key) return this.prepared;
    const note = await this.index.get<ImportNote>("note", key);
    if (!note) throw new Error("missingNote");
    const entry = await this.index.get<SourceEntry>("entry", note.entryKey);
    if (!entry) throw new Error("missingNote");
    if (this.format === "evernote") {
      let reader = this.enexReaders.get(entry.key);
      if (!reader || reader.ordinal >= note.ordinal!) {
        await reader?.iterator.return(undefined);
        reader = { iterator: readEnex(this.sources.bytes(entry, signal), entry.key, this.index, note.ordinal), ordinal: -1 };
        this.enexReaders.set(entry.key, reader);
      }
      let raw: EnexNote | undefined;
      while (reader.ordinal < note.ordinal!) {
        const next = await reader.iterator.next();
        if (next.done) throw new Error("missingNote");
        raw = next.value; reader.ordinal = raw.ordinal;
      }
      if (!raw) throw new Error("missingNote");
      const retained = new Set(note.resources.map(resource => resource.key));
      for (const resource of raw.resources) if (!retained.has(resource.key)) {
        for (let i = 0; i < (resource.chunks ?? 0); i++) await this.index.remove("chunk", `${resource.key}:${i}`);
      }
      this.prepared = { note: { ...note, resources: note.resources.map(res => ({ ...res, chunks: raw!.resources.find(item => item.key === res.key)?.chunks ?? 0 })) }, contentMarkdown: "", enml: raw.content };
      return this.prepared;
    }
    const text = await this.sources.text(entry, signal);
    return { note, contentMarkdown: note.raw ? readRaw(text)!.body : text };
  }
  async readResourcePart(resource: ImportResource, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    signal?.throwIfAborted();
    if (!resource.enex && !this.staged.has(resource.key)) {
      const entry = await this.index.get<SourceEntry>("entry", resource.entryKey!);
      if (!entry) throw new Error("missingResource");
      let chunk = new Uint8Array(IMPORT_CHUNK_BYTES), used = 0, number = 0;
      for await (const bytes of this.sources.bytes(entry, signal)) {
        let at = 0;
        while (at < bytes.length) {
          const length = Math.min(chunk.length - used, bytes.length - at);
          chunk.set(bytes.subarray(at, at + length), used); at += length; used += length;
          if (used === chunk.length) { await this.index.put("chunk", `${resource.key}:${number++}`, chunk); chunk = new Uint8Array(IMPORT_CHUNK_BYTES); used = 0; }
        }
      }
      if (used) await this.index.put("chunk", `${resource.key}:${number++}`, chunk.slice(0, used));
      this.staged.add(resource.key);
    }
    const result = new Uint8Array(end - start);
    let cursor = start;
    while (cursor < end) {
      const number = Math.floor(cursor / IMPORT_CHUNK_BYTES);
      const chunk = await this.index.get<Uint8Array>("chunk", `${resource.key}:${number}`);
      if (!chunk) throw new Error("missingResource");
      const at = cursor % IMPORT_CHUNK_BYTES;
      const length = Math.min(chunk.length - at, end - cursor);
      if (length <= 0) throw new Error("missingResource");
      result.set(chunk.subarray(at, at + length), cursor - start); cursor += length;
    }
    return result;
  }
  async releaseNote(note: ImportNote) {
    for (const res of note.resources) {
      for (let i = 0; i < Math.ceil(res.byteSize / IMPORT_CHUNK_BYTES); i++) await this.index.remove("chunk", `${res.key}:${i}`);
      this.staged.delete(res.key);
    }
    if (this.prepared?.note.key === note.key) this.prepared = undefined;
  }
  async finishReading() {
    for (const reader of this.enexReaders.values()) await reader.iterator.return(undefined).catch(() => {});
    this.enexReaders.clear(); this.prepared = undefined; this.staged.clear();
    await this.index.clearKind("chunk");
  }
  async close() {
    await this.finishReading();
    await this.sources.close(); await this.index.clear();
  }
}
