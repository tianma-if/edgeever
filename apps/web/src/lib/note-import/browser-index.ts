import Dexie, { type Table } from "dexie";
import type { ImportIndex, ImportKind } from "@edgeever/shared/note-import/types";

type RecordRow = { id: string; importId: string; kind: ImportKind; key: string; value: unknown };
class ImportDatabase extends Dexie {
  records!: Table<RecordRow, string>;
  constructor() {
    super("edgeever-note-imports");
    this.version(1).stores({ records: "id, importId, [importId+kind]" });
  }
}
const database = new ImportDatabase();
export class BrowserImportIndex implements ImportIndex {
  constructor(readonly importId: string) {}
  private id(kind: ImportKind, key: string) { return `${this.importId}\0${kind}\0${key}`; }
  async put<T>(kind: ImportKind, key: string, value: T) { await database.records.put({ id: this.id(kind, key), importId: this.importId, kind, key, value }); }
  async get<T>(kind: ImportKind, key: string) { return (await database.records.get(this.id(kind, key)))?.value as T | undefined; }
  async page<T>(kind: ImportKind, offset = 0, limit = 50) { return (await database.records.where("[importId+kind]").equals([this.importId, kind]).offset(offset).limit(limit).toArray()).map(row => row.value as T); }
  count(kind: ImportKind) { return database.records.where("[importId+kind]").equals([this.importId, kind]).count(); }
  async remove(kind: ImportKind, key: string) { await database.records.delete(this.id(kind, key)); }
  async clearKind(kind: ImportKind) { await database.records.where("[importId+kind]").equals([this.importId, kind]).delete(); }
  async clear() { await database.records.where("importId").equals(this.importId).delete(); }
}
