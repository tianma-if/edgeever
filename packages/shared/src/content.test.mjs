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
  resolveFileDisplayMode,
  PLUGIN_EMBED_NODE_TYPE,
  pluginEmbedToMarkdown,
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

  test("preserves native attachment metadata when upgrading a PDF link", () => {
    const doc = resolveMemoContentDoc({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "附件：报告.pdf",
          marks: [{
            type: "link",
            attrs: {
              href: "/api/v1/resources/res_pdf/blob",
              class: "edgeever-attachment-link edgeever-attachment-kind-pdf",
              attachmentFilename: "报告.pdf",
              attachmentMimeType: "application/pdf",
              attachmentByteSize: 12582912,
            },
          }],
        }],
      }],
    }, "");

    expect(doc.content[0]?.content?.[0]).toMatchObject({
      type: PDF_ATTACHMENT_NODE_TYPE,
      attrs: {
        filename: "报告.pdf",
        mimeType: "application/pdf",
        byteSize: 12582912,
      },
    });
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

  test("keeps a research category ending in .AI as a link, including an older rich-text link", () => {
    const markdown = "[arXiv cs.AI](https://arxiv.org/list/cs.AI/recent)";
    const parsed = markdownToDoc(markdown);
    expect(parsed.content[0]?.content?.[0]).toMatchObject({
      type: "text",
      text: "arXiv cs.AI",
      marks: [{ type: "link", attrs: { href: "https://arxiv.org/list/cs.AI/recent" } }],
    });
    expect(resolveMemoContentDoc(parsed, markdown).content[0]?.content?.[0]?.type).toBe("text");
    expect(markdownToDoc("[arXiv cs\\.AI](https://arxiv.org/list/cs.AI/recent)").content[0]?.content?.[0]?.type)
      .toBe("text");
  });

  test("repairs an already saved false attachment card without changing real .ai attachments", () => {
    const url = "https://arxiv.org/list/cs.AI/recent";
    const savedDoc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: FILE_ATTACHMENT_NODE_TYPE, attrs: { label: "arXiv cs.AI", filename: "arXiv cs.AI", url } }],
      }, {
        type: "paragraph",
        content: [{ type: FILE_ATTACHMENT_NODE_TYPE, attrs: { label: "icon.ai", url: "/api/v1/resources/res_ai/blob" } }],
      }],
    };
    const resolved = resolveMemoContentDoc(savedDoc, "");
    expect(resolved.content[0]?.content?.[0]).toMatchObject({
      type: "text",
      text: "arXiv cs.AI",
      marks: [{ type: "link", attrs: { href: url } }],
    });
    expect(resolved.content[1]?.content?.[0]?.type).toBe(FILE_ATTACHMENT_NODE_TYPE);
    expect(docToMarkdown(resolved).split("\n")[0]).toBe(`[arXiv cs.AI](${url})`);
  });

  test("recognizes an explicitly marked external attachment", () => {
    expect(markdownToDoc("[Attachment: icon.ai](https://example.com/download?id=1)").content[0]?.content?.[0]?.type)
      .toBe(FILE_ATTACHMENT_NODE_TYPE);
  });

  test("preserves an empty external link through Markdown and JSON", () => {
    const markdown = "Before [](https://example.com/path) and [named](https://example.com).";
    const doc = markdownToDoc(markdown);
    expect(doc.content[0]?.content?.[1]).toMatchObject({
      type: "edgeeverEmptyExternalLink",
      attrs: { href: "https://example.com/path" },
    });
    expect(docToMarkdown(doc)).toBe(markdown);
    expect(markdownToDoc("`[](https://example.com)`").content[0]?.content?.[0]?.type).toBe("text");
  });

  test("recovers an empty link from older content JSON", () => {
    const markdown = "Read [](https://example.com) here";
    const oldDoc = markdownToDoc("Read  here");
    expect(resolveMemoContentDoc(oldDoc, markdown)).toEqual(markdownToDoc(markdown));
  });

  test("keeps video preview expanded unless compact display mode is stored", () => {
    expect(resolveFileDisplayMode(undefined)).toBe("inline");
    expect(resolveFileDisplayMode("inline")).toBe("inline");
    expect(resolveFileDisplayMode("compact")).toBe("compact");
    expect(resolveFileDisplayMode("hidden")).toBe("inline");
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

  test("renders the issue #514 math fence while preserving its inline code example", () => {
    const inline = "$\\Gamma(n) = (n-1)!\\quad\\forall n\\in\\mathbb N$";
    const latex = "\\Gamma(z) = \\int_0^\\infty t^{z-1}e^{-t}dt\\,.";
    const doc = markdownToDoc(`The Gamma function satisfying \`${inline}\`\n\n\`\`\`math\n${latex}\n\`\`\``);
    expect(doc.content[0].content[1]).toMatchObject({ type: "text", text: inline, marks: [{ type: "code" }] });
    expect(doc.content[1]).toEqual({ type: "blockMath", attrs: { latex } });
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  test("uses standard fence parsing for tilde, longer, nested, and ordinary fences", () => {
    for (const fence of ["~~~", "````"]) {
      expect(markdownToDoc(`${fence}math\nx^2\n${fence}`).content[0]).toEqual({
        type: "blockMath", attrs: { latex: "x^2" },
      });
    }
    expect(markdownToDoc("> ```math\n> x^2\n> ```").content[0].content[0].type).toBe("blockMath");
    for (const language of ["", "latex", "javascript", "mermaid"]) {
      expect(markdownToDoc(`\`\`\`${language}\n$x$\n\`\`\``).content[0].type).toBe("codeBlock");
    }
    expect(markdownToDoc("```math\n\n```").content[0].type).toBe("codeBlock");
    expect(markdownToDoc("````markdown\n```math\nx^2\n```\n````").content[0].type).toBe("codeBlock");
  });

  test("keeps code dollar pairs unchanged through repeated Markdown round trips", () => {
    for (const source of ["`$x$`", "```js\nconst cost = '$100$';\nconst formula = '$x$';\n```", "```\n$$x^2$$\n```"]) {
      const original = markdownToDoc(source);
      let current = original;
      for (let i = 0; i < 3; i += 1) current = markdownToDoc(docToMarkdown(current));
      expect(current).toEqual(original);
      expect(docToMarkdown(original)).toBe(source);
    }
  });

  test("upgrades legacy math code blocks without losing rich table cells or image widths", () => {
    const legacy = {
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "math" }, content: [{ type: "text", text: "x^2" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [
          { type: "paragraph", content: [{ type: "text", text: "Rich", marks: [{ type: "bold" }] }] },
          { type: "image", attrs: { src: "/image.png", width: "50%" } },
        ] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "$x$", marks: [{ type: "code" }] }] },
      ],
    };
    const before = JSON.stringify(legacy);
    const resolved = resolveMemoContentDoc(legacy, "```math\nx^2\n```");
    expect(resolved.content[0]).toEqual({ type: "blockMath", attrs: { latex: "x^2" } });
    expect(resolved.content.slice(1)).toEqual(legacy.content.slice(1));
    expect(JSON.stringify(legacy)).toBe(before);
    expect(resolveMemoContentDoc(resolved, docToMarkdown(resolved))).toEqual(resolved);
  });

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

describe("details fold blocks", () => {
  test("parses GitHub details HTML and round-trips through Markdown", () => {
    const markdown = `<details>
<summary>展开看图</summary>

hello **world**

</details>`;
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]).toMatchObject({
      type: "details",
      content: [
        {
          type: "detailsSummary",
          content: [{ type: "text", text: "展开看图" }],
        },
        {
          type: "detailsContent",
          content: [{
            type: "paragraph",
            content: [
              { type: "text", text: "hello " },
              { type: "text", text: "world", marks: [{ type: "bold" }] },
            ],
          }],
        },
      ],
    });

    const serialized = docToMarkdown(doc);
    expect(serialized).toContain("<details>");
    expect(serialized).toContain("<summary>展开看图</summary>");
    expect(serialized).toContain("hello **world**");
    expect(markdownToDoc(serialized)).toEqual(doc);
  });

  test("converts an HTML image inside details into an image node", () => {
    const markdown = `<details>
<summary> </summary>
<img src="https://example.com/a.png" alt="pic" title="t" width=45% />
</details>`;
    const doc = markdownToDoc(markdown);
    expect(doc.content[0]?.content?.[1]?.content?.[0]).toMatchObject({
      type: "image",
      attrs: { src: "https://example.com/a.png", alt: "pic", title: "t", width: 45 },
    });
    const serialized = docToMarkdown(doc);
    expect(serialized).toContain('<img src="https://example.com/a.png" alt="pic" title="t" width="45%" />');
    expect(serialized).not.toContain("![pic]");
    expect(markdownToDoc(serialized).content[0]?.content?.[1]?.content?.[0]).toMatchObject({
      type: "image",
      attrs: { src: "https://example.com/a.png", alt: "pic", title: "t", width: 45 },
    });
  });

  test("keeps an image inside a details block and writes it back as HTML", () => {
    const markdown = `<details>
<summary>图</summary>

![pic](https://example.com/a.png)

</details>`;
    const doc = markdownToDoc(markdown);
    expect(doc.content[0]?.type).toBe("details");
    expect(doc.content[0]?.content?.[1]?.content?.[0]).toMatchObject({
      type: "image",
      attrs: { src: "https://example.com/a.png", alt: "pic", width: 50 },
    });
    expect(docToMarkdown(doc)).toContain('<img src="https://example.com/a.png" alt="pic" width="50%" />');
  });

  test("plays a remote video inside details through the existing attachment", () => {
    const markdown = `<details>
<summary>片段</summary>
<video src="https://cdn.example.com/watch/clip.mp4" controls alt=" " title=" " width=45%></video>
<video src="https://cdn.example.com/player?id=1" controls /></video>
<video src="javascript:alert(1)" controls></video>
</details>`;
    const doc = markdownToDoc(markdown);
    const body = doc.content[0]?.content?.[1]?.content || [];
    expect(body).toHaveLength(2);
    expect(body[0]?.content?.[0]).toMatchObject({
      type: FILE_ATTACHMENT_NODE_TYPE,
      attrs: {
        url: "https://cdn.example.com/watch/clip.mp4",
        filename: "clip.mp4",
        mimeType: "video/mp4",
        displayMode: "inline",
      },
    });
    expect(body[1]?.content?.[0]).toMatchObject({
      type: FILE_ATTACHMENT_NODE_TYPE,
      attrs: {
        url: "https://cdn.example.com/player?id=1",
        mimeType: "video/mp4",
        displayMode: "inline",
      },
    });

    const serialized = docToMarkdown(doc);
    expect(serialized).toContain('<video src="https://cdn.example.com/watch/clip.mp4" controls></video>');
    expect(serialized).toContain('<video src="https://cdn.example.com/player?id=1" controls></video>');
    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("width=");
    expect(markdownToDoc(serialized).content[0]?.content?.[1]?.content?.[0]?.content?.[0]).toMatchObject({
      type: FILE_ATTACHMENT_NODE_TYPE,
      attrs: { url: "https://cdn.example.com/watch/clip.mp4", mimeType: "video/mp4" },
    });
  });

  test("keeps an uploaded video attachment inside details as a resource link", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "details",
        content: [
          { type: "detailsSummary", content: [{ type: "text", text: "片段" }] },
          {
            type: "detailsContent",
            content: [{
              type: "paragraph",
              content: [{
                type: FILE_ATTACHMENT_NODE_TYPE,
                attrs: {
                  url: "/api/v1/resources/res_video/blob",
                  label: "附件：clip.mp4",
                  filename: "clip.mp4",
                  mimeType: "video/mp4",
                  displayMode: "inline",
                },
              }],
            }],
          },
        ],
      }],
    };

    const serialized = docToMarkdown(doc);
    expect(serialized).toContain("[附件：clip.mp4](/api/v1/resources/res_video/blob)");
    expect(serialized).not.toContain("<video");
  });

  test("leaves a video sample inside a details code fence untouched", () => {
    const markdown = `<details>
<summary>示例</summary>

\`\`\`html
<video src="https://cdn.example.com/clip.mp4" controls></video>
\`\`\`

</details>`;
    const serialized = docToMarkdown(markdownToDoc(markdown));
    expect(serialized).toContain('<video src="https://cdn.example.com/clip.mp4" controls></video>');
    expect(serialized).toContain("```html");
  });

  test("recovers details from Markdown when JSON only kept the tags as text", () => {
    const markdown = `<details>
<summary>提示</summary>

hidden

</details>`;
    const legacyDoc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: markdown }],
      }],
    };

    expect(resolveMemoContentDoc(legacyDoc, markdown).content[0]?.type).toBe("details");
  });
});

describe("extra blank lines", () => {
  test("keeps two visual blank lines as an empty paragraph", () => {
    const doc = markdownToDoc("A\n\n\nB");
    const emptyParagraphs = doc.content.filter((node) =>
      node.type === "paragraph" && (!node.content || node.content.length === 0)
    );

    expect(emptyParagraphs).toHaveLength(1);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  test("does not rewrite extra blank lines inside fenced code", () => {
    const markdown = "before\n\n```\nline\n\n\nline\n```\n\nafter";
    const doc = markdownToDoc(markdown);
    const code = doc.content.find((node) => node.type === "codeBlock");

    expect(code?.content?.[0]?.text).toBe("line\n\n\nline");
  });
});

describe("image gallery compatibility", () => {
  const galleryDoc = {
    type: "doc",
    content: [{
      type: "edgeeverImageGallery",
      attrs: { layout: "auto" },
      content: [
        { type: "image", attrs: { src: "/one.png", alt: "one" } },
        { type: "image", attrs: { src: "/two.png", alt: "two" } },
      ],
    }],
  };

  test("exports gallery images as portable sequential Markdown", () => {
    expect(docToMarkdown(galleryDoc)).toBe("![one](/one.png)\n\n![two](/two.png)");
  });

  test("keeps the richer gallery JSON when a Markdown projection also exists", () => {
    expect(resolveMemoContentDoc(galleryDoc, "![one](/one.png)\n\n![two](/two.png)"))
      .toEqual(galleryDoc);
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

describe("plugin embed Markdown compatibility", () => {
  test("round-trips a generic plugin embed without requiring the plugin renderer", () => {
    const attributes = {
      id: "embed_1",
      pluginId: "org.edgeever.excalidraw",
      type: "drawing",
      resourceId: "res_scene",
      previewResourceId: "res_preview",
      title: "Architecture",
      dataJson: JSON.stringify({ mode: "view" }),
    };
    const markdown = pluginEmbedToMarkdown(attributes);
    const parsed = markdownToDoc(markdown);

    expect(parsed.content[0]).toMatchObject({ type: PLUGIN_EMBED_NODE_TYPE, attrs: attributes });
    expect(docToMarkdown(parsed)).toBe(markdown);
    expect(resolveMemoContentDoc(parsed, "fallback").content[0].type).toBe(PLUGIN_EMBED_NODE_TYPE);
  });
});
