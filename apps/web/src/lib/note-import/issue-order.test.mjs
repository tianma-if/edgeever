import { expect, test } from "bun:test";
import { MemoryImportIndex, NoteImportSession } from "@edgeever/shared/note-import";

await import("fake-indexeddb/auto");
const { BrowserImportIndex } = await import("./browser-index");

test("missing timestamps and unreferenced attachments do not produce import issues", async () => {
  const index = new MemoryImportIndex();
  const session = new NoteImportSession("obsidian", [
    { path: "note.md", file: new File(["Plain note"], "note.md") },
    { path: "unused.png", file: new File(["unused"], "unused.png") },
  ], index);
  try {
    expect(await session.scan()).toMatchObject({ notes: 2, resources: 1, errors: 0, warnings: 0 });
    expect(await index.page("issue")).toEqual([]);
  } finally {
    await session.close();
  }
});

for (const [name, createIndex] of [
  ["memory", () => new MemoryImportIndex()],
  ["browser", () => new BrowserImportIndex(crypto.randomUUID())],
]) test(`${name}: blocking import errors precede warnings across preview pages`, async () => {
  const index = createIndex();
  const session = new NoteImportSession("obsidian", [
    ...Array.from({ length: 30 }, (_, i) => ({
      path: `note-${i}.md`,
      file: new File([`---\ntags: [${Array.from({ length: 25 }, (_, n) => `tag${n}`).join(", ")}]\n---\nNote without timestamps`], `note-${i}.md`),
    })),
    { path: "broken.md", file: new File(["![[missing-a.png]]\n![[missing-b.png]]"], "broken.md") },
    { path: "unused.png", file: new File(["unused"], "unused.png") },
  ], index);
  try {
    const summary = await session.scan();
    expect(summary).toMatchObject({ notes: 32, errors: 2, warnings: 30 });
    const first = await index.page("issue", 0, 20);
    expect(first).toHaveLength(20);
    expect(first.slice(0, 2).map(issue => issue.code)).toEqual(["missingResource", "missingResource"]);
    expect(new Set(first.slice(0, 2).map(issue => issue.detail))).toEqual(new Set(["missing-a.png", "missing-b.png"]));
    const issues = [...first, ...await index.page("issue", 20, 20)];
    expect(issues).toHaveLength(32);
    expect(new Set(issues.map(issue => issue.key)).size).toBe(32);
    expect(issues.slice(2).every(issue => issue.severity === "warning")).toBe(true);
    expect(issues.slice(2).every(issue => issue.code === "ignoredTags")).toBe(true);
  } finally {
    await session.close();
    await index.clear();
  }
});
