import type { ImportIndex, ImportKind } from "./types";

/** Tests and non-browser callers can supply this without changing parsing rules. */
export class MemoryImportIndex implements ImportIndex {
  private data = new Map<ImportKind, Map<string, unknown>>();
  async put<T>(kind: ImportKind, key: string, value: T) {
    let table = this.data.get(kind);
    if (!table) this.data.set(kind, table = new Map());
    table.set(key, value);
  }
  async get<T>(kind: ImportKind, key: string) { return this.data.get(kind)?.get(key) as T | undefined; }
  async page<T>(kind: ImportKind, offset = 0, limit = 50) {
    return [...(this.data.get(kind)?.entries() ?? [])].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(offset, offset + limit).map(([, value]) => value as T);
  }
  async count(kind: ImportKind) { return this.data.get(kind)?.size ?? 0; }
  async remove(kind: ImportKind, key: string) { this.data.get(kind)?.delete(key); }
  async clearKind(kind: ImportKind) { this.data.delete(kind); }
  async clear() { this.data.clear(); }
}
export async function* indexItems<T>(index: ImportIndex, kind: ImportKind) {
  for (let offset = 0; ; offset += 50) {
    const page = await index.page<T>(kind, offset, 50);
    if (!page.length) break;
    yield* page;
  }
}
