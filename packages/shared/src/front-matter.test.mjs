import { describe, expect, test } from "bun:test";
import { countMemoCharacters, docToText, docToMarkdown, markdownToDoc, resolveMemoContentDoc } from "./content.ts";
import { createFrontMatterNode, getFrontMatterSource, getMappedNoteProperties, mergeMarkdownFrontMatter, parseNoteProperties, splitMarkdownFrontMatter, updateNoteProperty } from "./front-matter.ts";

describe("note properties", () => {
  const header = '# retained comment\ntitle: "Imported note"\ntags: [archive, research]\nauthor: [Alice, Bob]\nsource: https://example.com\npublished: 2026-10-10\ndescription: |\n  First line\n  Second line\nnested:\n  custom: true';
  const markdown = `---\n${header}\n---\n\n# Body\n\nText **and** a [link](https://example.com).`;

  test("preserves raw YAML, unknown properties, lists, dates and comments across mode switches", () => {
    const doc = markdownToDoc(markdown);
    expect(getFrontMatterSource(doc)).toBe(header);
    expect(doc.content[1].type).toBe("heading");
    expect(getFrontMatterSource(markdownToDoc(docToMarkdown(doc)))).toBe(header);
    expect(parseNoteProperties(header).values.nested).toEqual({ custom: true });
  });

  test("edits individual properties without destroying comments or unknown nested data", () => {
    const next = updateNoteProperty(header, "source", "https://new.example.com");
    expect(next).toContain("# retained comment");
    expect(parseNoteProperties(next).values).toMatchObject({ author: ["Alice", "Bob"], nested: { custom: true }, source: "https://new.example.com" });
  });

  test("maps title and tags without accepting IDs or arbitrary system metadata", () => {
    expect(getMappedNoteProperties({ title: " Note ", tags: "#one, two one", edgeever_id: "foreign" })).toEqual({ title: "Note", tags: ["one", "two"] });
    expect(getMappedNoteProperties({ title: 12, tags: ["valid", 4] })).toEqual({});
  });

  test("merges export metadata into one header while preserving the body and custom fields", () => {
    const exported = mergeMarkdownFrontMatter(markdown, { title: "Current note", tags: ["new"], edgeever_id: "current" });
    const split = splitMarkdownFrontMatter(exported);
    expect(split.values).toMatchObject({ title: "Current note", tags: ["new"], author: ["Alice", "Bob"], nested: { custom: true }, edgeever_id: "current" });
    expect(split.body).toBe(splitMarkdownFrontMatter(markdown).body);
    expect(exported.match(/^---$/gm)).toHaveLength(2);
  });

  test("does not mistake ordinary Markdown rules or unclosed headers for properties", () => {
    for (const source of ["---\nHeading\n---\nBody", "---\ntitle: unfinished", "Body\n---\ntitle: body\n---", "```yaml\ntitle: example\n```", "---\n- list item\n---"]) {
      expect(splitMarkdownFrontMatter(source)).toBeNull();
    }
  });

  test("supports BOM, CRLF, empty headers and YAML closing markers", () => {
    expect(splitMarkdownFrontMatter("\uFEFF---\r\ntitle: Example\r\n...\r\nBody").values.title).toBe("Example");
    expect(parseNoteProperties("").values).toEqual({});
    expect(getFrontMatterSource(markdownToDoc("---\n\n---\nBody"))).toBe("");
    expect(getFrontMatterSource(markdownToDoc("---\n---\nBody"))).toBe("");
  });

  test("keeps malformed and duplicate-key YAML recoverable instead of silently flattening it", () => {
    for (const source of ["title: [unclosed", "title: One\ntitle: Two", "nested: !unknown value"]) {
      const original = `---\n${source}\n---\n\nBody`;
      expect(splitMarkdownFrontMatter(original).error).toBeTruthy();
      expect(getFrontMatterSource(markdownToDoc(original))).toBe(source);
      expect(docToMarkdown(markdownToDoc(original))).toStartWith(`---\n${source}\n---`);
      expect(mergeMarkdownFrontMatter(original, { title: "New" })).toBe(original);
    }
  });

  test("limits oversized headers and alias expansion without losing raw source", () => {
    expect(parseNoteProperties(`key: ${"a".repeat(65536)}`).error).toBeTruthy();
    expect(parseNoteProperties("recursive: &self [*self]").error).toBeTruthy();
    expect(parseNoteProperties("a: &a [1, 2]\nb: &b [*a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]").error).toBeTruthy();
  });

  test("recovers properties saved by an old codec as a regular code fence", () => {
    const oldMarkdown = `\`\`\`edgeever-frontmatter\n${header}\n\`\`\`\n\nBody`;
    const doc = markdownToDoc(oldMarkdown);
    expect(getFrontMatterSource(doc)).toBe(header);
    expect(docToMarkdown(doc)).toStartWith(`---\n${header}\n---`);
    expect(resolveMemoContentDoc(doc, oldMarkdown)).toEqual(doc);
    const exported = mergeMarkdownFrontMatter(oldMarkdown, { title: "Current title" });
    expect(splitMarkdownFrontMatter(exported).values.author).toEqual(["Alice", "Bob"]);
    expect(exported).not.toContain("```edgeever-frontmatter");
  });

  test("keeps richer JSON body attributes when properties are present", () => {
    const doc = { type: "doc", content: [createFrontMatterNode(header), { type: "image", attrs: { src: "https://example.com/image.png", width: "80%" } }] };
    expect(resolveMemoContentDoc(doc, docToMarkdown(doc))).toEqual(doc);
  });

  test("keeps metadata out of body excerpts and character counts", () => {
    const doc = markdownToDoc(`---\n${header}\n---\n\nHello world`);
    expect(docToText(doc)).toBe("Hello world");
    expect(countMemoCharacters(doc)).toBe(10);
  });
});
