// Run with Bun against isolated old / upgraded / rollback servers on the same database.
// Keep the fixture outside the repository: it contains the synthetic public form token.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createEdgeEverClient } from "../../../../packages/client/src/index.ts";
import { parseTableDocument, serializeTableDocument } from "../../../../packages/shared/src/table.ts";

const [step, origin, fixturePath] = process.argv.slice(2);
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const client = createEdgeEverClient({ baseUrl: origin });
const field = { id: "text", name: "Text", type: "text" };
const row = index => ({ id: "r" + index, cells: { text: "original-" + index } });
const writeFixture = data => writeFile(fixturePath, JSON.stringify(data), { mode: 0o600 });
const progress = async () => {
  const response = await fetch(origin + "/api/v1/admin/table-storage");
  assert.equal(response.status, 200);
  return (await response.json()).progress;
};
const read = async id => parseTableDocument((await client.getMemo(id)).memo.contentMarkdown);
const edit = async (id, ordinal, value) => {
  const { editSession } = await client.createMemoEditSession(id);
  const table = await read(id);
  table.records[ordinal].cells.text = value;
  await client.updateMemo(id, { expectedRevision: editSession.baseRevision,
    expectedContentHash: editSession.baseContentHash, editSessionId: editSession.id, contentMarkdown: serializeTableDocument(table) });
};

if (step === "seed") {
  const { notebooks } = await client.listNotebooks();
  const refs = [];
  for (const version of [1, 2]) {
    const table = { schemaVersion: version, fields: [field], records: Array.from({length: 250}, (_, i) => row(i)),
      ...(version === 1 ? {view: {filters: [], sort: null}} : {views: [{id: "all", name: "All", match: "all", filters: [], sorts: []}]}) };
    const { memo } = await client.createMemo({notebookId: notebooks[0].id, title: "Online upgrade v" + version, contentMarkdown: serializeTableDocument(table)});
    refs.push(memo.id);
  }
  const { form } = await client.updateTableForm(refs[1], { enabled: true, passwordProtected: false, title: "Online upgrade",
    description: "", submitLabel: "Send", fields: [{fieldId: field.id, required: true}] });
  await writeFixture({refs, token: form.token, edits: 0});
  console.log("Old release created v1 and v2 tables with 250 rows each and a public form.");
} else {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const [first, second] = fixture.refs;
  if (step === "write") {
    const before = await progress();
    assert.equal(before.phase, "copying");
    const sequence = fixture.edits + 1;
    const { cursor } = await client.syncChanges({cursor: 0, limit: 200});
    await edit(first, 0, "editor-" + sequence);
    // The legacy sync queue binds an edit session and sends this conditional PATCH on reconnect.
    await edit(second, 1, "sync-" + sequence);
    await client.submitPublicTableForm(fixture.token, {text: "form-" + sequence});
    const { changes } = await client.syncChanges({cursor, limit: 200});
    for (const id of fixture.refs) assert(changes.some(change => change.entityType === "memo" && change.entityId === id && change.operation === "upsert"));
    fixture.edits = sequence;
    await writeFixture(fixture);
    console.log(JSON.stringify({before, after: await progress(), writeRound: sequence}));
  } else {
    assert(["cutover", "rollback", "readback"].includes(step));
    assert.equal((await progress()).phase, "active");
    const a = await read(first), b = await read(second);
    assert.equal(a.schemaVersion, 1);
    assert.equal(b.schemaVersion, 2);
    const originalIds = Array.from({length: 250}, (_, i) => row(i).id);
    assert.deepEqual(a.records.map(r => r.id), originalIds);
    assert.deepEqual(b.records.slice(0, 250).map(r => r.id), originalIds);
    assert.equal(a.records[0].cells.text, "editor-" + fixture.edits);
    assert.equal(b.records[1].cells.text, "sync-" + fixture.edits);
    assert.equal(b.records.length, 250 + fixture.edits);
    for (let i = 1; i <= fixture.edits; i++) assert.equal(b.records[249+i].cells.text, "form-" + i);
    if (step === "cutover") await edit(first, 2, "after-cutover");
    if (step !== "cutover") assert.equal(a.records[2].cells.text, "after-cutover");
    if (step === "rollback") await edit(first, 3, "from-rollback-service");
    if (step === "readback") assert.equal(a.records[3].cells.text, "from-rollback-service");
    console.log(JSON.stringify({step, firstRows: a.records.length, secondRows: b.records.length, writeRounds: fixture.edits}));
  }
}
