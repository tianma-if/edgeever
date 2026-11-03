import sax from "sax";
import SparkMD5 from "spark-md5";
import { IMPORT_CHUNK_BYTES, type ImportIndex, type ImportResource } from "./types";

export type EnexNote = { ordinal: number; title: string; content: string; tags: string[]; created: string; updated: string; resources: ImportResource[] };
/** SAX flushes text after every bounded input chunk, including huge base64 fields. */
export async function* readEnex(
  source: AsyncIterable<Uint8Array<ArrayBuffer>>, path: string, index?: ImportIndex, stageFrom = Infinity,
): AsyncGenerator<EnexNote> {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const stack: string[] = [];
  let ordinal = -1;
  let root = false;
  let note: EnexNote | undefined;
  let resource: ImportResource | undefined;
  let digest: SparkMD5.ArrayBuffer | undefined;
  let carry = "";
  let chunk = new Uint8Array(IMPORT_CHUNK_BYTES);
  let used = 0;
  let tagText = "";
  let resourceNumber = 0;
  const ready: EnexNote[] = [];
  let writes: Promise<void>[] = [];
  const stage = (bytes: Uint8Array<ArrayBuffer>) => {
    if (!resource || !index || ordinal < stageFrom) return;
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(chunk.length - used, bytes.length - offset);
      chunk.set(bytes.subarray(offset, offset + length), used);
      used += length; offset += length;
      if (used === chunk.length) {
        writes.push(index.put("chunk", `${resource.key}:${resource.chunks ?? 0}`, chunk));
        resource.chunks = (resource.chunks ?? 0) + 1;
        chunk = new Uint8Array(IMPORT_CHUNK_BYTES); used = 0;
      }
    }
  };
  const decode = (text: string) => {
    const clean = text.replace(/\s/g, "");
    if (/[^A-Za-z0-9+/=]/.test(clean)) throw new Error("invalidBase64");
    carry += clean;
    const length = carry.length - carry.length % 4;
    if (!length) return;
    const value = atob(carry.slice(0, length));
    carry = carry.slice(length);
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
    resource!.byteSize += bytes.length;
    digest!.append(bytes.buffer);
    stage(bytes);
  };
  parser.onopentag = tag => {
    stack.push(tag.name);
    if (stack.length === 1) { if (tag.name !== "en-export") throw new Error("invalidEnex"); root = true; }
    if (tag.name === "note" && stack.length === 2) {
      ordinal += 1; resourceNumber = 0;
      note = { ordinal, title: "", content: "", tags: [], created: "", updated: "", resources: [] };
    }
    if (note && tag.name === "resource" && stack.length === 3) {
      resource = { key: `enex:${path}:${ordinal}:${resourceNumber++}`, filename: "", mimeType: "application/octet-stream", byteSize: 0, enex: true, chunks: 0 };
      digest = new SparkMD5.ArrayBuffer(); carry = ""; used = 0; chunk = new Uint8Array(IMPORT_CHUNK_BYTES);
    }
    if (resource && tag.name === "data" && tag.attributes.encoding !== "base64") throw new Error("unsupportedEnexEncoding");
    if (tag.name === "tag") tagText = "";
  };
  const text = (value: string) => {
    if (!note) return;
    const name = stack.at(-1);
    if (resource) {
      if (name === "data") decode(value);
      else if (name === "mime") resource.mimeType = (resource.mimeType === "application/octet-stream" ? "" : resource.mimeType) + value;
      else if (name === "file-name") resource.filename += value;
    } else if (name === "title") note.title += value;
    else if (name === "created") note.created += value;
    else if (name === "updated") note.updated += value;
    else if (name === "tag") tagText += value;
    else if (name === "content") note.content += value;
  };
  parser.ontext = text;
  parser.oncdata = text;
  parser.onclosetag = name => {
    if (name === "data" && resource) {
      if (carry) throw new Error("invalidBase64");
      if (index && ordinal >= stageFrom && used) {
        writes.push(index.put("chunk", `${resource.key}:${resource.chunks ?? 0}`, chunk.slice(0, used)));
        resource.chunks = (resource.chunks ?? 0) + 1;
      }
      resource.hash = digest!.end();
    }
    if (name === "resource" && resource) {
      resource.filename ||= `attachment-${resourceNumber}`;
      note!.resources.push(resource); resource = undefined; digest = undefined;
    }
    if (name === "tag" && note) note.tags.push(tagText.trim());
    if (name === "note" && note) { ready.push(note); note = undefined; }
    stack.pop();
  };
  const decoder = new TextDecoder();
  for await (const bytes of source) {
    for (let at = 0; at < bytes.length; at += IMPORT_CHUNK_BYTES) {
      parser.write(decoder.decode(bytes.subarray(at, at + IMPORT_CHUNK_BYTES), { stream: true })).flush();
      await Promise.all(writes); writes = [];
      while (ready.length) yield ready.shift()!;
    }
  }
  parser.write(decoder.decode()).close();
  await Promise.all(writes);
  if (!root) throw new Error("invalidEnex");
  while (ready.length) yield ready.shift()!;
}
