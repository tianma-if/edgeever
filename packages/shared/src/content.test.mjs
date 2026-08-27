import { describe, expect, test } from "bun:test";
import {
  countMemoCharacters,
  docToMarkdown,
  docToText,
  markdownToDoc,
  MERGE_DIVIDER_MARKDOWN_MARKER,
  MERGE_DIVIDER_NODE_TYPE,
  FILE_ATTACHMENT_NODE_TYPE,
  PDF_ATTACHMENT_NODE_TYPE,
  mergeMemoDocs,
  resolvePdfDisplayMode,
  resolveMemoContentDoc,
  resolveMemoContentMarkdown,
  resolveMergedMemoTitle,
} from "./content.ts";

describe("merged memo title", () => {
  test("prefers an explicit title, then the first custom source title", () => {
    const sources = [{ title: "无标题笔记" }, { title: "  手动标题  " }, { title: "另一个标题" }];

    expect(resolveMergedMemoTitle("  指定标题  ", sources)).toBe("指定标题");
    expect(resolveMergedMemoTitle(undefined, sources)).toBe("手动标题");
  });

  test("uses a dated merge title when every source is untitled", () => {
    expect(resolveMergedMemoTitle(undefined, [{ title: null }, { title: "无标题笔记" }], new Date(2026, 7, 2)))
      .toBe("合并笔记 2026/8/2");
  });
});

describe("PDF attachment Markdown compatibility", () => {
  test("parses a standalone PDF link as a viewer node and preserves the link on export", () => {
    const markdown = "[Attachment: report.pdf](/api/v1/resources/res_pdf/blob)";
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]).toMatchObject({
      type: "paragraph",
      content: [{
        type: PDF_ATTACHMENT_NODE_TYPE,
        attrs: {
          label: "Attachment: report.pdf",
          url: "/api/v1/resources/res_pdf/blob",
          displayMode: "compact",
        },
      }],
    });
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  test("upgrades a legacy standalone PDF link paragraph", () => {
    const legacyDoc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Attachment: archive.pdf",
          marks: [{ type: "link", attrs: { href: "/api/v1/resources/res_archive/blob" } }],
        }],
      }],
    };

    expect(resolveMemoContentDoc(legacyDoc, "").content[0]?.content?.[0]?.type).toBe(PDF_ATTACHMENT_NODE_TYPE);
  });

  test("renders PDF links nested in Markdown lists", () => {
    const doc = markdownToDoc("- [Product brief.pdf](/api/v1/resources/res_pdf/blob)");
    expect(doc.content[0]?.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe(PDF_ATTACHMENT_NODE_TYPE);
  });

  test("defaults legacy values to compact and accepts the persisted inline mode", () => {
    expect(resolvePdfDisplayMode(undefined)).toBe("compact");
    expect(resolvePdfDisplayMode("expanded")).toBe("compact");
    expect(resolvePdfDisplayMode("inline")).toBe("inline");
  });

  test("keeps a per-attachment display mode in rich content without changing Markdown", () => {
    const richDoc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: PDF_ATTACHMENT_NODE_TYPE,
          attrs: {
            label: "Attachment: report.pdf",
            url: "/api/v1/resources/res_pdf/blob",
            displayMode: "inline",
          },
        }],
      }],
    };

    expect(resolveMemoContentDoc(richDoc, "[Attachment: report.pdf](/api/v1/resources/res_pdf/blob)"))
      .toEqual(richDoc);
    expect(docToMarkdown(richDoc)).toBe("[Attachment: report.pdf](/api/v1/resources/res_pdf/blob)");
  });
});

describe("file attachment Markdown compatibility", () => {
  test("parses a stored non-PDF resource link as an attachment card", () => {
    const markdown = "[Attachment: budget.xlsx](/api/v1/resources/res_sheet/blob)";
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]).toMatchObject({
      type: "paragraph",
      content: [{
        type: FILE_ATTACHMENT_NODE_TYPE,
        attrs: {
          label: "Attachment: budget.xlsx",
          filename: "budget.xlsx",
          url: "/api/v1/resources/res_sheet/blob",
        },
      }],
    });
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  test("keeps an ordinary standalone web link as text", () => {
    const doc = markdownToDoc("[EdgeEver](https://edgeever.org)");
    expect(doc.content[0]?.content?.[0]?.type).toBe("text");
  });

  test("upgrades a legacy standalone attachment link from rich content", () => {
    const legacyDoc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "附件：archive.zip",
          marks: [{ type: "link", attrs: { href: "/api/v1/resources/res_archive/blob" } }],
        }],
      }],
    };

    expect(resolveMemoContentDoc(legacyDoc, "").content[0]?.content?.[0]?.type).toBe(FILE_ATTACHMENT_NODE_TYPE);
  });
});

describe("memo character count", () => {
  test("counts punctuation while excluding whitespace and formatting", () => {
    const doc = markdownToDoc("你好， **EdgeEver**!\n\n下一行");

    expect(countMemoCharacters(doc)).toBe(15);
  });

  test("counts grapheme clusters and ignores image labels", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "e\u0301 👨‍👩‍👧‍👦" }] },
        { type: "image", attrs: { alt: "不计入" } },
      ],
    };

    expect(countMemoCharacters(doc)).toBe(2);
  });
});

describe("Markdown table conversion", () => {
  const markdown = [
    "| Name | Status |",
    "| --- | --- |",
    "| Editor | Ready |",
    "| Mobile | Planned |",
  ].join("\n");

  test("parses a GFM table into TipTap nodes", () => {
    const doc = markdownToDoc(markdown);

    expect(doc.content).toHaveLength(1);
    expect(doc.content[0]?.type).toBe("table");
    expect(doc.content[0]?.content?.[0]?.type).toBe("tableRow");
    expect(doc.content[0]?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(doc.content[0]?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
  });

  test("preserves table values through a Markdown round trip", () => {
    const serialized = docToMarkdown(markdownToDoc(markdown));
    const reparsed = markdownToDoc(serialized);

    expect(serialized).toContain("| Name");
    expect(serialized).toContain("| Editor");
    expect(reparsed).toEqual(markdownToDoc(markdown));
  });

  test("recovers a table omitted by an older JSON schema", () => {
    const legacyDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy note" }] }],
    };

    expect(resolveMemoContentDoc(legacyDoc, markdown).content[0]?.type).toBe("table");
    expect(resolveMemoContentDoc(legacyDoc, "Legacy note")).toBe(legacyDoc);
  });
});

describe("legacy Markdown body recovery", () => {
  test("recovers a body when the stored JSON document is empty", () => {
    const markdown = "权威和反中心化特征，即当一个人成为某种代表性的符号之后";
    const resolved = resolveMemoContentDoc(markdownToDoc(""), markdown);

    expect(docToText(resolved)).toContain(markdown);
  });

  test("recovers Markdown from rich content when the compatibility copy is empty", () => {
    const richContent = markdownToDoc("这段正文只保存在富文本 JSON 中。");

    expect(resolveMemoContentMarkdown(richContent, "")).toContain("这段正文只保存在富文本 JSON 中。");
  });
});

describe("Nested list Markdown conversion", () => {
  const markdown = [
    "- Level 1",
    "  - Level 2",
    "    - Level 3",
    "  - Another level 2",
    "- Another level 1",
  ].join("\n");

  test("preserves nested list hierarchy through a Markdown round trip", () => {
    const doc = markdownToDoc(markdown);

    const topList = doc.content[0];
    const firstItem = topList?.content?.[0];
    const secondLevelList = firstItem?.content?.[1];
    const secondLevelItem = secondLevelList?.content?.[0];

    expect(topList?.type).toBe("bulletList");
    expect(topList?.content).toHaveLength(2);
    expect(firstItem?.type).toBe("listItem");
    expect(secondLevelList?.type).toBe("bulletList");
    expect(secondLevelList?.content).toHaveLength(2);
    expect(secondLevelItem?.content?.[1]?.type).toBe("bulletList");
    expect(secondLevelItem?.content?.[1]?.content).toHaveLength(1);
    expect(docToMarkdown(doc)).toBe(markdown);
  });
});

describe("Markdown task list conversion", () => {
  const markdown = [
    "- [ ] Pending task",
    "- [x] Completed task",
    "  - [ ] Nested task",
  ].join("\n");

  test("preserves checked state and nesting through a Markdown round trip", () => {
    const doc = markdownToDoc(markdown);
    const taskList = doc.content[0];

    expect(taskList?.type).toBe("taskList");
    expect(taskList?.content?.[0]).toMatchObject({
      type: "taskItem",
      attrs: { checked: false },
    });
    expect(taskList?.content?.[1]).toMatchObject({
      type: "taskItem",
      attrs: { checked: true },
    });
    expect(taskList?.content?.[1]?.content?.[1]?.type).toBe("taskList");
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  test("recovers task semantics retained only in the Markdown compatibility copy", () => {
    const legacyDoc = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Pending task" }] }],
        }],
      }],
    };

    const resolved = resolveMemoContentDoc(legacyDoc, "- [ ] Pending task");
    expect(resolved.content[0]?.type).toBe("taskList");
    expect(resolved.content[0]?.content?.[0]).toMatchObject({
      type: "taskItem",
      attrs: { checked: false },
    });
  });
});

describe("Mermaid Markdown conversion", () => {
  const markdown = "```mermaid\nflowchart LR\n  A --> B\n```";

  test("preserves Mermaid fenced code blocks through a Markdown round trip", () => {
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "mermaid" },
    });
    expect(docToMarkdown(doc)).toBe(markdown);
  });
});

describe("LaTeX Markdown conversion", () => {
  const markdown = "Euler: $e^{i\\pi}+1=0$.\n\n$$\n\\frac{a}{b}\n$$";

  test("round-trips inline and block formula nodes", () => {
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]?.content?.[1]).toMatchObject({
      type: "inlineMath",
      attrs: { latex: "e^{i\\pi}+1=0" },
    });
    expect(doc.content[1]).toMatchObject({
      type: "blockMath",
      attrs: { latex: "\\frac{a}{b}" },
    });
    expect(docToMarkdown(doc)).toBe(markdown);
    expect(docToText(doc)).toContain("e^{i\\pi}+1=0");
    expect(docToText(doc)).toContain("\\frac{a}{b}");
  });

  test("keeps currency and escaped dollar pairs as literal text", () => {
    const doc = markdownToDoc("Price: $100$; literal: \\$x$.");
    const serialized = docToMarkdown(doc);

    expect(doc.content[0]?.content?.some((node) => node.type === "inlineMath")).toBe(false);
    expect(serialized).toBe("Price: \\$100\\$; literal: \\$x\\$.");
    expect(markdownToDoc(serialized)).toEqual(doc);
  });

  test("recovers formula nodes omitted by an older JSON schema", () => {
    const legacyDoc = markdownToDoc("Euler: $e^{i\\pi}+1=0$.");
    legacyDoc.content[0] = {
      type: "paragraph",
      content: [{ type: "text", text: "Euler: $e^{i\\pi}+1=0$." }],
    };

    const resolved = resolveMemoContentDoc(legacyDoc, markdown);
    expect(resolved.content[0]?.content?.[1]?.type).toBe("inlineMath");
    expect(resolved.content[1]?.type).toBe("blockMath");
  });
});

describe("Theme block compatibility", () => {
  test("keeps themed blocks in the richer JSON document when Markdown is also present", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "edgeeverThemeBlock",
        attrs: { kind: "key-point" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Important" }] }],
      }],
    };

    expect(resolveMemoContentDoc(doc, "Important")).toBe(doc);
  });

  test("exports themed blocks as readable quoted Markdown instead of dropping their text", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "edgeeverThemeBlock",
        attrs: { kind: "intro" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Read this first" }] }],
      }],
    };

    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("\\[intro\\]");
    expect(markdown).toContain("Read this first");
  });
});

describe("merge divider", () => {
  test("joins source docs with a semantic merge divider node", () => {
    const merged = mergeMemoDocs([
      markdownToDoc("first note"),
      markdownToDoc("second note"),
    ]);

    expect(merged.content.map((node) => node.type)).toEqual([
      "paragraph",
      MERGE_DIVIDER_NODE_TYPE,
      "paragraph",
    ]);
    expect(docToText(merged)).toContain("first note");
    expect(docToText(merged)).toContain("second note");
  });

  test("round-trips merge dividers through Markdown without becoming a plain hr", () => {
    const merged = mergeMemoDocs([markdownToDoc("alpha"), markdownToDoc("beta")]);
    const markdown = docToMarkdown(merged);
    const reparsed = markdownToDoc(markdown);

    expect(markdown).toContain(MERGE_DIVIDER_MARKDOWN_MARKER);
    expect(markdown).toContain("alpha");
    expect(markdown).toContain("beta");
    expect(reparsed.content.map((node) => node.type)).toEqual([
      "paragraph",
      MERGE_DIVIDER_NODE_TYPE,
      "paragraph",
    ]);
    // Plain decorative rules still parse as horizontalRule.
    expect(markdownToDoc("a\n\n---\n\nb").content.map((node) => node.type)).toEqual([
      "paragraph",
      "horizontalRule",
      "paragraph",
    ]);
  });

  test("recovers merge dividers when only the Markdown copy still has the marker", () => {
    const markdown = docToMarkdown(mergeMemoDocs([markdownToDoc("left"), markdownToDoc("right")]));
    const legacyDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "left" }] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "right" }] },
      ],
    };

    const resolved = resolveMemoContentDoc(legacyDoc, markdown);
    expect(resolved.content.some((node) => node.type === MERGE_DIVIDER_NODE_TYPE)).toBe(true);
  });
});
