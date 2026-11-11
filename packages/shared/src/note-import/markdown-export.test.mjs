import { expect, test } from "bun:test";
import { NoteImportSession } from "./session";
import { MemoryImportIndex } from "./index-store";
import { normalizeExportMedia } from "./markdown-export-html";

const files = values => Object.entries(values).map(([path, text]) => ({ path, file: new File([text], path), expandArchive: false }));
const scan = async (format, values) => {
  const session = new NoteImportSession(format, files(values), new MemoryImportIndex());
  const summary = await session.scan();
  return { session, summary };
};

test("Notion preserves distinct same-name folders and original page paths", async () => {
  const { session, summary } = await scan("notion", {
    [`Same ${"a".repeat(32)}/Page.md`]: "# First",
    [`Same ${"b".repeat(32)}/Page.md`]: "# Second",
  });
  expect(summary).toMatchObject({ notes: 2, notebooks: 2, errors: 0 });
  const folders = await session.index.page("notebook");
  expect(folders.map(f => f.name)).toEqual(["Same", "Same"]);
  expect(folders[0].key).not.toBe(folders[1].key);
  await session.close();
});

test("CSV-only exports produce a downloadable attachment without parsing away cells", async () => {
  const { session, summary } = await scan("notion", { "Data.csv": 'Title,Text\n"a","line 1\nline 2"' });
  expect(summary).toMatchObject({ notes: 1, resources: 1, errors: 0 });
  expect((await session.index.page("issue")).some(i => i.code === "notionCsv")).toBe(true);
  const [note] = await session.index.page("note");
  expect((await session.readNote(note.key)).contentMarkdown).toBe("[Data.csv](Data.csv)");
  await session.close();
});

test("SiYuan media HTML uses the shared attachment resolver, including spaces", async () => {
  const { session, summary } = await scan("siyuan", {
    "Book/Child/Page.md": '# Media\n\n<video controls src="assets/a b.mp4"></video>\n\n![pic](assets/p.png)\n\n[block](siyuan://blocks/20240101000000-abcdefg)',
    "Book/assets/a b.mp4": "video bytes", "Book/assets/p.png": "image bytes",
  });
  expect(summary).toMatchObject({ notes: 1, resources: 2, errors: 0 });
  const [note] = await session.index.page("note");
  expect((await session.readNote(note.key)).contentMarkdown).toContain("assets/a%20b.mp4");
  expect(note.resources.map(r => r.entryKey).sort()).toEqual(["Book/assets/a b.mp4", "Book/assets/p.png"]);
  expect((await session.index.page("issue")).some(i => i.code === "noteLink")).toBe(true);
  await session.close();
});

test("HTML media conversion leaves code samples intact and removes executable HTML", () => {
  const code = '```html\n<video src="missing.mp4"></video>\n```\n\n`<img src="missing.png">`';
  expect(normalizeExportMedia(code)).toBe(code);
  const media = normalizeExportMedia('<div><script>alert(1)</script><audio src="assets/a.mp3"></audio><img src="javascript:alert(1)"></div>');
  expect(media).toContain("assets/a.mp3");
  expect(media).not.toContain("alert");
  expect(media).not.toContain("script");
});

test("SiYuan assets that contain Markdown stay attachments", async () => {
  const { session, summary } = await scan("siyuan", { "Page.md": "[file](assets/file.md)", "assets/file.md": "# attachment" });
  expect(summary).toMatchObject({ notes: 1, resources: 1, errors: 0 });
  await session.close();
});

for (const format of ["notion", "siyuan"]) {
  test(`${format}: unsupported source data and path traversal block preflight`, async () => {
    const { session, summary } = await scan(format, { "good.md": "[bad](../../private.txt)", "data.sy": "{}", "nested.zip": "zip" });
    expect(summary.errors).toBe(3);
    expect((await session.index.page("issue")).filter(i => i.code === "markdownExportRequired")).toHaveLength(2);
    await session.close();
  });
  test(`${format}: front matter overrides opening title and code headings are not titles`, async () => {
    const { session } = await scan(format, {
      "Front.md": '---\ntitle: Explicit\ntags: [one]\n---\n# Heading',
      "Code.md": '```md\n# Example\n```',
    });
    const notes = await session.index.page("note");
    expect(notes.map(n => n.title).sort()).toEqual(["Code", "Explicit"]);
    expect(notes.find(n => n.title === "Explicit").tags).toEqual(["one"]);
    await session.close();
  });
}
