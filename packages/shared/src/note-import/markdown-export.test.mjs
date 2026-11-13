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

test("Notion strips database IDs from standalone CSV titles and keeps the all-rows marker", async () => {
  const id = "a".repeat(32);
  const { session } = await scan("notion", { [`Database ${id}.csv`]: "Name\nOne", [`Database ${id}_all.csv`]: "Name\nOne" });
  const notes = await session.index.page("note");
  expect(notes.map(note => note.title)).toEqual(["Database", "Database_all"]);
  expect(notes[1].resources[0].filename).toBe(`Database ${id}_all.csv`);
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

test("HTML media preserves adjacent Markdown in quotes and lists", () => {
  expect(normalizeExportMedia('> <img src="assets/p.png" alt="Picture">\n> **Keep me**')).toBe('> ![Picture](assets/p.png)\n> **Keep me**');
  expect(normalizeExportMedia('- <video><source src="assets/clip.mp4"></video>\n  **Keep me**')).toBe('- [clip.mp4](assets/clip.mp4)\n  **Keep me**');
});

test("Missing SiYuan Markdown assets and pages warn without blocking import", async () => {
  const { session, summary } = await scan("siyuan", { "Book/Child/Page.md": "[file](assets/missing.md)\n\n[page](missing.md)" });
  expect(summary).toMatchObject({ notes: 1, errors: 0, warnings: 2 });
  expect((await session.index.page("issue")).map(issue => issue.code).sort()).toEqual(["missingAttachment", "noteLink"].sort());
  await session.close();
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
      "Indented.md": '    # Example',
      "Tagged.md": '---\ntags: [one]\n---\n\n# Real heading ###',
    });
    const notes = await session.index.page("note");
    expect(notes.map(n => n.title).sort()).toEqual(["Code", "Explicit", "Indented", "Real heading"]);
    expect(notes.find(n => n.title === "Explicit").tags).toEqual(["one"]);
    await session.close();
  });
}

for (const wrapper of [
  '<div><img src="assets/p.png"></div>',
  '<div data-label="a > b"><div><img src="assets/p.png"></div></div>',
  '<figure><img src="assets/p.png"><figcaption>Caption</figcaption></figure>',
]) test(`wrapped HTML preserves following Markdown: ${wrapper}`, () => {
  for (const prefix of ["", "> ", "  "]) {
    const tail = '[download](assets/file.pdf)\n![other](assets/other.png)\n**Keep bold**';
    const input = [wrapper, ...tail.split("\n")].map(line => prefix + line).join("\n");
    const converted = normalizeExportMedia(input);
    expect(converted).toContain('![](assets/p.png)');
    expect(converted).not.toContain('\\[download\\]');
    expect(converted.endsWith(tail.split("\n").map(line => prefix + line).join("\n"))).toBe(true);
  }
});

test("multiline media containers preserve Markdown boundaries in lists, quotes and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) for (const [first, next] of [["", ""], ["> ", "> "], ["- ", "  "]]) {
    const lines = ['<div>', '<div><img src="assets/p.png"></div>', '</div>', '[download](assets/file.pdf)', '![other](assets/other.png)', '**Keep bold**'];
    const markdown = lines.map((line, i) => (i ? next : first) + line).join(newline);
    const result = normalizeExportMedia(markdown);
    expect(result).toContain('![](assets/p.png)');
    expect(result).not.toContain('\\[download\\]');
    expect(result.endsWith(lines.slice(3).map(line => next + line).join(newline))).toBe(true);
    expect(result).not.toContain('<div>');
  }
});

for (const html of [
  '<div><img src="assets/p.png"></div>\n<div><img src="assets/other.png"></div>',
  '<div><script>const x="</div>";</script><img src="assets/p.png"></div>',
  '  <img src="assets/p.png">',
]) test(`media boundaries handle siblings, raw text and indentation: ${html}`, () => {
  const result = normalizeExportMedia(html + '\n[download](assets/file.pdf)\n**Keep bold**');
  expect(result).toContain('![](assets/p.png)');
  expect(result.endsWith('[download](assets/file.pdf)\n**Keep bold**')).toBe(true);
  expect(result).not.toMatch(/<\/?(?:div|script)>/);
  if (html.includes('other.png')) expect(result).toContain('![](assets/other.png)');
});

test("HTML-like code cannot capture later real media", () => {
  for (const code of ['```html\n<div>\n```', '`<script>`']) {
    const result = normalizeExportMedia('<div><img src="a.png"></div>\n' + code + '\n<img src="b.png">\n[file](file.pdf)');
    expect(result).toContain(code);
    expect(result).toContain('![](b.png)');
    expect(result.endsWith('[file](file.pdf)')).toBe(true);
  }
});

test("implicit HTML closing at EOF does not consume the following source character", () => {
  for (const newline of ["\n", "\r\n", "\r"]) for (const prefix of ["", "> "]) {
    const tail = newline + prefix.trimEnd() + newline + prefix + '[link](f.pdf)';
    expect(normalizeExportMedia(prefix + '<div><img src="a.png">' + tail)).toBe(prefix + '![](a.png)' + tail);
  }
});

test("escaped HTML cannot capture later real media", () => {
  const markdown = '<div><img src="a.png"></div>\n\\<div>\n<img src="b.png">\n[file](f.pdf)';
  const result = normalizeExportMedia(markdown);
  expect(result).toContain('\\<div>');
  expect(result).toContain('![](b.png)');
  expect(result.endsWith('[file](f.pdf)')).toBe(true);
});
