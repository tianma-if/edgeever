import type { TableDocument, TableRecord } from "./table";

export type TableRowMutation = {
  expectedRevision: number;
  expectedContentHash: string;
  mutationId: string;
  editSessionId: string;
  puts: TableRecord[];
  deletes: string[];
};

export type TableRowReceipt = {
  revision: number;
  contentHash: string;
  updatedAt: string;
  tableRevision: number;
};

export type TableSyncBase = {
  contentMarkdown: string;
  title: string;
  tags: string[];
};

export type TableRowChange =
  | { revision: number; id: string; deleted: true }
  | ({ revision: number; position: number; deleted: false } & TableRecord);

export type TableChangeCursor = { revision: number; recordId: string };
export type TableChangesPage = {
  revision: number;
  schemaRevision: number;
  recordCount: number;
  header: TableDocument;
  changes: TableRowChange[];
  next: TableChangeCursor | null;
};
