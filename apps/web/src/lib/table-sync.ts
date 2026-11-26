import { buildTableDocumentMarkdown, createExcerpt, docToText, getTableSummary, markdownToDoc, parseTableDocument, type MemoDetail, type SyncChange, type TableChangeCursor, type TableDocument, type TableRowChange, type TableRowMutation, type TableRowReceipt, type TableSyncBase, type TiptapDoc } from "@edgeever/shared";
import { ApiRequestError, api } from "@/lib/api";
import { sha256Hex } from "./plugins/plugin-sha256";

type QueuedTableDraft = {
  tableBase?: unknown;
  expectedRevision: number;
  expectedContentHash: string;
  title: string;
  tags: string[];
  contentMarkdown?: string;
};

export const tableSyncBase = (memo: Pick<MemoDetail, "contentMarkdown" | "title" | "tags">): TableSyncBase => ({
  contentMarkdown: memo.contentMarkdown, title: memo.title ?? "", tags: memo.tags,
});

export const queuedTableMutation = async (draft: QueuedTableDraft, editSessionId: string): Promise<TableRowMutation | null> => {
  const base = draft.tableBase as Partial<TableSyncBase> | undefined;
  if (!base || base.title !== draft.title || JSON.stringify(base.tags) !== JSON.stringify(draft.tags)) return null;
  const previous = parseTableDocument(base.contentMarkdown);
  const next = parseTableDocument(draft.contentMarkdown);
  if (!previous || !next) return null;
  const { records: oldRows, cellEncoding: _oldEncoding, ...oldHeader } = previous;
  const { records: newRows, cellEncoding: _newEncoding, ...newHeader } = next;
  if (JSON.stringify(oldHeader) !== JSON.stringify(newHeader)) return null;

  const old = new Map(oldRows.map((record) => [record.id, record]));
  const remaining = new Set(newRows.map((record) => record.id));
  const expectedOrder = [...oldRows.filter(({ id }) => remaining.has(id)), ...newRows.filter(({ id }) => !old.has(id))];
  if (newRows.some(({ id }, index) => expectedOrder[index]?.id !== id)) return null;
  const puts = newRows.filter((record) => JSON.stringify(record.cells) !== JSON.stringify(old.get(record.id)?.cells));
  const deletes = oldRows.filter(({ id }) => !remaining.has(id)).map(({ id }) => id);
  if (!puts.length && !deletes.length) return null;
  const { expectedRevision, expectedContentHash } = draft;
  const mutationId = await sha256Hex(JSON.stringify([expectedRevision, expectedContentHash, puts, deletes]));
  return { expectedRevision, expectedContentHash, editSessionId, mutationId, puts, deletes };
};

const tableMemoContent = (contentMarkdown: string, contentJson: TiptapDoc) => {
  const contentText = docToText(contentJson);
  return { ...getTableSummary(contentMarkdown), contentMarkdown, contentJson, contentText, excerpt: createExcerpt(contentText) };
};

export const acknowledgeTableDraft = (
  memo: MemoDetail,
  draft: { title: string; contentMarkdown?: string; contentJson: TiptapDoc; tags: string[] },
  receipt: TableRowReceipt,
): MemoDetail => ({
  ...memo,
  title: draft.title,
  tags: draft.tags,
  ...tableMemoContent(draft.contentMarkdown ?? memo.contentMarkdown, draft.contentJson),
  revision: receipt.revision,
  sharedTableRevision: receipt.tableRevision,
  contentHash: receipt.contentHash,
  updatedAt: receipt.updatedAt,
});

export const applyTableRowChanges = (base: TableDocument, changes: TableRowChange[]) => {
  const revisions = new Map<number, TableRowChange[]>();
  for (const change of changes) {
    const rows = revisions.get(change.revision) ?? [];
    rows.push(change);
    revisions.set(change.revision, rows);
  }
  let records = base.records;
  for (const rows of revisions.values()) {
    const deletes = new Set(rows.filter((row) => row.deleted).map((row) => row.id));
    const puts = new Map(rows.flatMap((row) => row.deleted ? [] : [[row.id, row] as const]));
    const surviving = records.filter(({ id }) => !deletes.has(id));
    const touched = [...puts.values()].sort((left, right) => left.position - right.position);
    if (surviving.every(({ id }) => puts.has(id))) {
      // Explicit snapshot restore/reorder emits each surviving row, even unchanged cells.
      records = touched.map(({ id, cells }) => ({ id, cells }));
      continue;
    }
    const existing = new Set(surviving.map(({ id }) => id));
    records = surviving.map((record) => {
      const changed = puts.get(record.id);
      return changed ? { id: changed.id, cells: changed.cells } : record;
    });
    records.push(...touched.filter(({ id }) => !existing.has(id)).map(({ id, cells }) => ({ id, cells })));
  }
  return records;
};

export const materializeTableChanges = async (
  changes: SyncChange[],
  readLocal: (memoId: string) => Promise<MemoDetail | null | undefined>,
): Promise<SyncChange[]> => {
  const results: SyncChange[] = [];
  for (const change of changes) {
    const through = change.memo?.sharedTableRevision;
    if (!change.tableRecords || !change.memo || through == null) {
      results.push(change);
      continue;
    }
    const memo = change.memo;
    const readSnapshot = async () => {
      try {
        return { ...change, memo: (await api.getMemo(memo.id, { includeDeleted: true })).memo, tableRecords: undefined };
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
          return { ...change, operation: "delete" as const, memo: null, tableRecords: undefined };
        }
        throw error;
      }
    };
    const base = await readLocal(memo.id);
    const since = base?.sharedTableRevision;
    const document = parseTableDocument(base?.contentMarkdown);
    if (since == null || since > through || !document) {
      results.push(await readSnapshot());
      continue;
    }
    let after: TableChangeCursor | undefined;
    let table = document;
    const records: TableRowChange[] = [];
    let count = document.records.length;
    if (since !== through) {
      try {
        do {
          const page = await api.tableRecordChanges(memo.id, { since, through, after });
          table = page.header;
          records.push(...page.changes);
          count = page.recordCount;
          after = page.next ?? undefined;
        } while (after);
      } catch (error) {
        // An instance reset or deletion can invalidate an already fetched change page.
        if (!(error instanceof ApiRequestError) || (error.status !== 404 && error.code !== "revision_conflict")) throw error;
        results.push(await readSnapshot());
        continue;
      }
      table = { ...table, records: applyTableRowChanges(document, records) };
    }
    if (table.records.length !== count) throw new Error("Shared table sync returned an incomplete revision");
    const { markdown, fallback } = buildTableDocumentMarkdown(table);
    const contentJson = markdownToDoc(fallback);
    results.push({ ...change, tableRecords: undefined, memo: { ...memo, ...tableMemoContent(markdown, contentJson) } });
  }
  return results;
};
