import { expect, test } from "bun:test";
import { serializeTableDocument } from "@edgeever/shared";
import { applyTableRowChanges, queuedTableMutation } from "./table-sync";

const old = {
  schemaVersion: 1, fields: [{ id: "text", name: "Text", type: "text" }],
  view: { filters: [], sort: null },
  records: [{ id: "a", cells: { text: "original" } }, { id: "b", cells: { text: "remove" } }],
};
test("a persisted table draft sends changed rows, deletions and a stable replay key", async () => {
  const payload = {
    title: "Table", tags: [], expectedRevision: 5, expectedContentHash: "hash",
    tableBase: { title: "Table", tags: [], contentMarkdown: serializeTableDocument(old) },
    contentMarkdown: serializeTableDocument({ ...old, records: [{ id: "a", cells: { text: "edited" } }] }),
  };
  const first = await queuedTableMutation(payload, "session-1");
  expect(first.puts).toEqual([{ id: "a", cells: { text: "edited" } }]);
  expect(first.deletes).toEqual(["b"]);
  expect((await queuedTableMutation(payload, "session-after-reconnect")).mutationId).toBe(first.mutationId);
  expect(await queuedTableMutation({ ...payload, title: "Renamed" }, "session-1")).toBeNull();
  expect(await queuedTableMutation({ ...payload, contentMarkdown: serializeTableDocument({ ...old, records: [...old.records].reverse() }) }, "session-1")).toBeNull();
});


test("incremental pulls preserve surviving order and apply explicit reorder snapshots", () => {
  const base = { ...old, records: [...old.records, { id: "c", cells: { text: "unchanged" } }] };
  const merged = applyTableRowChanges(base, [
    { revision: 2, id: "b", deleted: true },
    { revision: 2, id: "c", position: 5, deleted: false, cells: { text: "updated" } },
    { revision: 2, id: "d", position: 8, deleted: false, cells: { text: "added" } },
  ]);
  expect(merged.map((row) => row.id)).toEqual(["a", "c", "d"]);
  expect(merged[1].cells.text).toBe("updated");
  const reordered = applyTableRowChanges({ ...base, records: merged }, [...merged].reverse().map((row, i) => ({
    revision: 3, id: row.id, position: i + 1, deleted: false, cells: row.cells,
  })));
  expect(reordered.map((row) => row.id)).toEqual(["d", "c", "a"]);
});
