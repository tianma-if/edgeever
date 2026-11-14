import type { ImportIndex } from "./types";
import { IMPORT_CHUNK_BYTES } from "./types";

/** Temporary, range-readable bytes in the existing task index. */
export class ImportByteStore {
  constructor(
    private index: ImportIndex,
    private kind: "chunk" | "archiveChunk",
    private key: string,
    private chunkBytes = IMPORT_CHUNK_BYTES,
  ) {}

  async stage(source: AsyncIterable<Uint8Array>) {
    let buffer = new Uint8Array(this.chunkBytes);
    let used = 0;
    let number = 0;
    for await (const bytes of source) {
      let offset = 0;
      while (offset < bytes.length) {
        const length = Math.min(buffer.length - used, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + length), used);
        offset += length;
        used += length;
        if (used === buffer.length) {
          await this.index.put(this.kind, `${this.key}:${number++}`, buffer);
          buffer = new Uint8Array(this.chunkBytes);
          used = 0;
        }
      }
    }
    if (used) await this.index.put(this.kind, `${this.key}:${number}`, buffer.slice(0, used));
    return number * this.chunkBytes + used;
  }

  async read(start: number, end: number) {
    const result = new Uint8Array(end - start);
    for (let cursor = start; cursor < end;) {
      const number = Math.floor(cursor / this.chunkBytes);
      const chunk = await this.index.get<Uint8Array>(this.kind, `${this.key}:${number}`);
      const offset = cursor % this.chunkBytes;
      const length = chunk ? Math.min(chunk.length - offset, end - cursor) : 0;
      if (!chunk || length <= 0) throw new Error(this.kind === "archiveChunk" ? "invalidArchive" : "missingResource");
      result.set(chunk.subarray(offset, offset + length), cursor - start);
      cursor += length;
    }
    return result;
  }
}
