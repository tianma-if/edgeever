import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
const testPng = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=", "base64"));

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
const originalGetComputedStyle = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");

const linkedomWindow = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
try {
  Object.defineProperty(linkedomWindow.document, "compatMode", { value: "CSS1Compat" });
} catch {
  // linkedom may already expose a read-only quirks flag. KaTeX still renders.
}
globalThis.window = linkedomWindow;
globalThis.document = linkedomWindow.document;
globalThis.Node = linkedomWindow.Node;
globalThis.HTMLElement = linkedomWindow.HTMLElement;
globalThis.getComputedStyle = typeof linkedomWindow.getComputedStyle === "function"
  ? linkedomWindow.getComputedStyle.bind(linkedomWindow)
  : () => ({ getPropertyValue: () => "" });

const restoreGlobal = (name, descriptor) => {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
};

afterAll(() => {
  restoreGlobal("window", originalWindow);
  restoreGlobal("document", originalDocument);
  restoreGlobal("Node", originalNode);
  restoreGlobal("HTMLElement", originalHTMLElement);
  restoreGlobal("getComputedStyle", originalGetComputedStyle);
});

const css = (element) => (element?.style.cssText ?? "").replace(/:\s+/g, ":");

let preparePublishArticle;
let prepareMarkdownPublishArticle;
let readEditorCopyContext;
let createPublishMathImage;
let embedImagesForWeChat;
let loadPublishImage;

beforeAll(async () => {
  const module = await import("./wechat-copy.ts");
  preparePublishArticle = module.preparePublishArticle;
  prepareMarkdownPublishArticle = module.prepareMarkdownPublishArticle;
  readEditorCopyContext = module.readEditorCopyContext;
  createPublishMathImage = module.createPublishMathImage;
  embedImagesForWeChat = module.embedImagesForWeChat;
  loadPublishImage = module.loadPublishImage;
});

describe("publication copies of ordinary images", () => {
  const withImageEnvironment = async (run) => {
    const fetchBefore = globalThis.fetch;
    const locationBefore = window.location;
    window.location = { origin: "https://notes.example.com", href: "https://notes.example.com/" };
    try { await run(); } finally { globalThis.fetch = fetchBefore; window.location = locationBefore; }
  };

  test("preserves GIF, animated WebP, APNG and animated AVIF bytes including generic MIME responses", async () => withImageEnvironment(async () => {
    for (const [extension, mime] of [["gif", "image/gif"], ["webp", "image/webp"], ["png", "image/png"], ["avif", "image/avif"]]) {
      const bytes = new Uint8Array(readFileSync(`tests/fixtures/publish-animation/two-frames.${extension}`));
      for (const contentType of [mime, "application/octet-stream"]) {
        globalThis.fetch = async () => new Response(bytes, { headers: { "Content-Type": contentType } });
        const blob = await loadPublishImage(`https://external.example.com/animation.${extension}`);
        expect(blob.type).toBe(mime);
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
      }
    }
  }));

  test("uploads external, inline and blob images once per source, preserving layout and native math", async () => withImageEnvironment(async () => {
    const loaded = [];
    const uploaded = [];
    globalThis.fetch = async (url, init) => {
      loaded.push([url, init.credentials]);
      return new Response(testPng, { headers: { "Content-Type": "image/png" } });
    };
    const root = document.createElement("section");
    root.innerHTML = `<p><img src="https://external.example.com/a.png" srcset="old 2x" width="240" alt="photo"></p>
      <table><tr><td><img src="https://external.example.com/a.png"></td></tr></table>
      <img src="data:image/png;base64,aW1hZ2U="><img src="blob:https://notes.example.com/example">
      <img class="ztext-math" data-tex="x^2" src="data:image/png;base64,bWF0aA==">
      <img data-ee-published-image="true" src="https://cdn.example.com/mermaid.jpg">`;
    await embedImagesForWeChat(root, async (blob) => {
      uploaded.push(await blob.text()); return `https://cdn.example.com/published-${uploaded.length}.png`;
    });
    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual(["https://external.example.com/a.png", "same-origin"]);
    expect(uploaded).toHaveLength(4);
    expect(root.querySelectorAll("[data-ee-published-image]")).toHaveLength(5);
    expect(root.querySelector("img").getAttribute("width")).toBe("240");
    expect(root.querySelector("img").getAttribute("alt")).toBe("photo");
    expect(root.querySelector("[srcset]")).toBeNull();
    expect(root.querySelector("table img").src).toStartWith("https://cdn.example.com/");
    expect(root.querySelector(".ztext-math").getAttribute("src")).toBe("data:image/png;base64,bWF0aA==");
  }));

  test("private attachment requests use the authenticated API for web and desktop-style resource URLs", async () => withImageEnvironment(async () => {
    const { api } = await import("./api.ts");
    const previous = api.getResourceResponse;
    const requests = [];
    api.getResourceResponse = async (path) => { requests.push(path); return new Response(testPng, { headers: { "Content-Type": "image/png" } }); };
    globalThis.fetch = async () => { throw new Error("Private images must use the API client"); };
    try {
      for (const source of ["/api/v1/resources/res_1/blob", "https://notes.example.com/api/v1/resources/res_1/blob", "edgeever-resource://resource/res_1"]) {
        expect(new Uint8Array(await (await loadPublishImage(source)).arrayBuffer())).toEqual(testPng);
      }
      expect(requests).toEqual(Array(3).fill("/api/v1/resources/res_1/blob"));
    } finally { api.getResourceResponse = previous; }
  }));

  test("failed reads or uploads stop copying instead of retaining private or broken URLs", async () => withImageEnvironment(async () => {
    for (const failRead of [true, false]) {
      globalThis.fetch = async () => failRead ? new Response("denied", { status: 403 })
        : new Response(testPng, { headers: { "Content-Type": "image/png" } });
      const root = document.createElement("section");
      root.innerHTML = '<img src="https://external.example.com/image.png">';
      await expect(embedImagesForWeChat(root, async () => { throw new Error("Host unavailable"); }))
        .rejects.toMatchObject({ reason: "upload" });
    }
  }));
});

const MARKDOWN = `
> **EdgeEver** 把笔记留在你自己的账号里。

正文里的行内代码是 \`#memo=<笔记ID>\`，起步价（$10+/月）。

| 成本 | 商业订阅高昂（$10+/月） | 官方云同步收费（$5+/月） |
| --- | --- | --- |

- **行内公式**：例如质能方程 $E = mc^2$。
- **多行独立公式块**：
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV
$$

- [x] 已完成的待办
- [ ] 未完成的待办

\`\`\`sh
# 官方 GHCR 镜像
curl -fsSL https://edgeever.org/install.sh | bash
\`\`\`
`;

describe("preparePublishArticle", () => {
  test("uses a section wrapper so Zhihu can import headings and paragraphs separately", () => {
    const html = "<p>Introduction</p><h2>Chapter</h2><p>Body</p><h3>Details</h3><p>End</p>";
    const markdown = "Introduction\n\n## Chapter\n\nBody\n\n### Details\n\nEnd";
    for (const root of [preparePublishArticle(html), prepareMarkdownPublishArticle(markdown)]) {
      expect(root.tagName).toBe("SECTION");
      expect(Array.from(root.children, (element) => element.tagName)).toEqual(["P", "H2", "P", "H3", "P"]);
      expect(root.querySelector("h2").textContent).toBe("Chapter");
      expect(css(root.querySelector("h2"))).toContain("font-weight:600");
      expect(css(root)).toContain("background-color:#ffffff");
      expect(root.outerHTML).toMatch(/^<section\b/);
    }
  });

  test("exports a light reading accent from a dark editor", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "violet";
    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => ({
        "--note-palette-accent": "#B39AE8",
        "--note-palette-light-accent": "#7351CF",
        "--note-palette-text": "#3F3F46",
        "--note-palette-surface": "#F4F4F5",
        "--note-palette-divider": "#E1DEFF",
        "--note-palette-code-bg": "#F3F1FF",
        "--note-palette-code-text": "#5B4EE0",
      })[name] ?? "",
    });
    try {
      const context = readEditorCopyContext(container);
      expect(context.colors.accent).toBe("#7351CF");
      expect(context.colors.codeText).toBe("#5B4EE0");
      expect(context.colors.codeBackground).toBe("#F3F1FF");
      expect(context.colors.surface).toBe("#F4F4F5");
      expect(context.colors.divider).toBe("#E1DEFF");
      const root = preparePublishArticle([
        "<p><strong>重点</strong> <code>Cmd/Ctrl + E</code></p>",
        "<table><thead><tr><th>表头</th></tr></thead><tbody><tr><td>第1行</td></tr><tr><td>第2行</td></tr></tbody></table>",
      ].join(""), container);
      expect(css(root.querySelector("strong"))).toContain("color:#7351CF");
      expect(css(root.querySelector("code"))).toContain("color:#1f2937");
      expect(css(root.querySelector("code"))).toContain("background:#f3f4f6");
      expect(css(root.querySelector("code"))).toContain("font-weight:600");
      const th = root.querySelector("th");
      expect(css(th)).toContain("background:#7351CF");
      expect(css(th)).toContain("color:#ffffff");
      expect(css(th)).toContain("border:1px solid #e5e5e5");
      const rows = root.querySelectorAll("tbody tr");
      expect(css(rows[1].querySelector("td"))).toContain("background-color:#f9fafb");
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });

  test("keeps nested editor table paragraphs compact and header text readable", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "violet";
    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => ({
        "--note-palette-light-accent": "#7351CF",
        "--note-palette-text": "#27272a",
      })[name] ?? "",
    });
    try {
      for (const palette of ["violet", "native"]) {
        container.dataset.notePalette = palette;
        const root = preparePublishArticle(
          '<p>正文</p><table><tbody><tr><th><p>表头 <strong>重点</strong></p></th></tr>' +
          '<tr><td><p>内容 <strong>重点</strong></p><p>第二段</p></td></tr></tbody></table>', container,
        );
        const header = root.querySelector("th p");
        expect(css(header)).toContain(`color:${palette === "violet" ? "#ffffff" : "#111827"}`);
        expect(css(header)).toContain("font-size:13.44px");
        expect(css(header.querySelector("strong"))).toContain(`color:${palette === "violet" ? "#ffffff" : "#111827"}`);
        for (const paragraph of root.querySelectorAll("th p, td p")) {
          expect(css(paragraph)).toContain("margin:0");
          expect(css(paragraph)).toContain("line-height:1.45");
        }
        expect(css(root.querySelector("td p"))).toContain("font-size:16px");
        expect(css(root.querySelector("td strong"))).toContain("color:#111827");
        expect(css(root.firstElementChild)).toContain("color:#27272a");
        expect(css(root.firstElementChild)).not.toContain("margin:0;");
      }
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });

  test("matches the light editor instead of the old rose-and-green paste", () => {
    const root = preparePublishArticle([
      "<blockquote><p>引用</p></blockquote>",
      "<p>正文 <strong>重点</strong> <code>token</code></p>",
      "<h2>标题</h2>",
      "<hr>",
      "<hr data-edgeever-merge-divider>",
      "<pre><code class=\"language-sh\"># 官方 GHCR 镜像\\ncurl</code></pre>",
      "<ul data-type=\"taskList\"><li data-checked=\"true\"><label><input type=\"checkbox\" checked></label><div><p>已完成</p></div></li></ul>",
      "<span data-type=\"inline-math\" data-latex=\"E = mc^2\"></span>",
      "<p>#memo 话题</p>",
      "<img src=\"https://example.com/test.png\" alt=\"pic\">",
    ].join(""));

    const img = root.querySelector("img");
    expect(css(img)).toContain("border-radius:12px");
    expect(css(img)).toContain("box-shadow:0 4px 12px -2px rgba(0,0,0,0.08)");
    expect(css(img)).toContain("padding:6px");
    expect(css(img)).not.toContain("#b8dfd0");

    const quote = root.querySelector("blockquote");
    expect(css(quote)).toContain("background:#f3f5f7");
    expect(css(quote)).toContain("color:#3d4450");
    expect(css(quote)).toContain("border:0");
    expect(css(quote)).not.toContain("10b981");
    expect(css(quote.querySelector("p"))).toContain("color:#3d4450");
    expect(css(quote.querySelector("p"))).not.toContain("#27272a");
    const body = root.querySelector("blockquote").nextElementSibling;
    expect(css(body)).toContain("color:#27272a");
    expect(css(root.querySelector("strong"))).toContain("font-weight:800");
    const inlineCode = body.querySelector("code");
    expect(css(inlineCode)).toContain("color:#1f2937");
    expect(css(inlineCode)).toContain("background:#f3f4f6");
    expect(css(inlineCode)).toContain("font-weight:600");
    expect(css(root.querySelector("h2"))).toContain("font-weight:600");
    expect(css(root.querySelector("h2"))).toContain("color:#27272a");
    const [rule, merge] = root.querySelectorAll("hr");
    expect(css(rule)).toContain("1px solid #1a1d21");
    expect(css(merge)).toContain("2px solid #1a1d21");

    const math = root.querySelector("[data-ee-math='inline']");
    expect(math?.querySelector(".katex")).toBeTruthy();
    expect(math?.textContent).not.toContain("$E");
    expect(root.querySelector("input")).toBeNull();
    expect(root.querySelector("[data-ee-task='checked']")?.textContent).toBe("☑ ");
    expect(root.textContent).toContain("已完成");
    const checked = root.querySelector("[data-ee-task='checked']")?.parentElement;
    expect(css(checked)).toContain("color:#737373");
    expect(css(checked)).toContain("line-through");

    const highlighted = root.querySelector("pre code");
    expect(highlighted?.querySelector("span[style*='color']")).toBeTruthy();
    expect(highlighted?.textContent).toContain("# 官方");
    expect(highlighted?.textContent).not.toContain("#\u200b官方");
    expect(root.textContent).toContain("#\u200bmemo");
    expect(root.innerHTML).not.toContain("#be123c");
    expect(root.innerHTML).not.toContain("#10b981");
  });

  test("applies composable emerald, numbered headings, dashed quotes, and marker emphasis for WeChat", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "emerald";
    container.dataset.noteHeadingStyle = "numbered";
    container.dataset.noteQuoteStyle = "dashed";
    container.dataset.noteEmphasisStyle = "marker";
    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => ({
        "--note-palette-accent": "#059669",
        "--note-palette-light-accent": "#059669",
        "--note-palette-text": "#374151",
        "--note-palette-surface": "#F0FDF4",
        "--note-palette-divider": "#A7F3D0",
        "--note-palette-code-bg": "#ECFDF5",
        "--note-palette-code-text": "#047857",
      })[name] ?? "",
    });
    try {
      const root = preparePublishArticle([
        "<h2>章节标题</h2>",
        "<h3>小节胶囊</h3>",
        "<blockquote><p><strong>摸鱼绿虚线引用框</strong></p></blockquote>",
        "<p><strong>翡翠重点</strong> <u>薄荷底线</u> <mark>暖黄高亮</mark> <code>neutralCode</code></p>",
      ].join(""), container);
      const h2 = root.querySelector("h2");
      expect(h2?.textContent).toContain("01");
      expect(h2?.textContent).toContain("PART");
      expect(h2?.textContent).toContain("章节标题");
      expect(h2?.querySelector("[data-ee-heading-number]")?.innerHTML).toContain("#059669");
      const h3 = root.querySelector("h3");
      expect(css(h3)).not.toContain("border-radius:1em");
      expect(h3?.querySelector("[data-ee-pill-dot]")).toBeNull();
      expect(css(h3)).toContain("font-weight:700");
      const quote = root.querySelector("blockquote");
      expect(css(quote)).toContain("border:1px dashed #d1d5db");
      expect(css(quote)).toContain("background:#f9fafb");
      expect(css(quote?.querySelector("strong"))).toContain("border-bottom:3px solid #fde68a");
      expect(css(root.querySelector("p > strong"))).toContain("color:#059669");
      expect(css(root.querySelector("u"))).toContain("border-bottom:2px solid #A7F3D0");
      expect(css(root.querySelector("mark"))).toContain("background-color:#fde68a");
      expect(css(root.querySelector("code"))).toContain("background:#f3f4f6");
      expect(css(root.querySelector("code"))).toContain("color:#1f2937");
      expect(css(root.querySelector("code"))).toContain("font-weight:600");
      expect(root.querySelector("[data-ee-cover-card]")).toBeNull();
      expect(root.querySelector("[data-ee-toc-cards]")).toBeNull();
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });

  test("numbered headings follow body size in clean editorial hierarchy", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "native";
    container.dataset.noteHeadingStyle = "numbered";
    const previous = globalThis.getComputedStyle;
    try {
      for (const size of [14, 16, 18]) {
        globalThis.getComputedStyle = () => ({
          getPropertyValue: (name) => name === "--editor-body-font-size" ? `${size}px` : "",
        });
        const root = preparePublishArticle("<h2>章节</h2><h3>包含 <strong>强调</strong> 的长标题</h3><h4>子标题</h4><p>正文</p>", container);
        expect(root.querySelector("h3").style.fontSize).toBe(`${Math.round(size * 1.15)}px`);
        expect(root.querySelector("h4").style.fontSize).toBe(`${size}px`);
        expect(root.querySelector("p:not([data-ee-publish-chrome])").style.fontSize).toBe(`${size}px`);
        const h2Title = Array.from(root.querySelectorAll("h2 p")).find((p) => p.textContent === "章节");
        expect(h2Title.style.fontSize).toBe(`${size * 1.4}px`);
        expect(root.querySelector("h3 strong").textContent).toBe("强调");
        expect(root.querySelectorAll("[data-ee-pill-dot]").length).toBe(0);
      }
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });

  test("exports body rhythm independently of headings and keeps table cells compact", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "native";
    const previous = globalThis.getComputedStyle;
    try {
      for (const headingStyle of ["default", "bar", "numbered"]) {
        container.dataset.noteHeadingStyle = headingStyle;
        globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => ({
          "--editor-paragraph-spacing": "12px",
          "--editor-body-text-align": "justify",
          "--editor-body-letter-spacing": "0.5px",
        })[name] ?? "" });
        const root = preparePublishArticle("<h3>标题</h3><p>正文</p><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table>", container);
        const body = root.querySelector(":scope > p");
        expect(body.style.margin).toBe("0 0 12px");
        expect(body.style.textAlign).toBe("justify");
        expect(body.style.letterSpacing).toBe("0.5px");
        const cell = root.querySelector("td p");
        expect(cell.style.margin).toBe("0");
        expect(cell.style.textAlign).toBe("inherit");
      }
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });

  test("renders magazine cover and chapter navigation independently", () => {
    const container = document.createElement("div");
    container.dataset.notePalette = "emerald";
    container.dataset.noteHeadingStyle = "numbered";
    container.dataset.noteMagazineCover = "true";
    container.dataset.noteChapterNavigation = "true";
    container.dataset.noteTitle = "深度评测文章";
    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => ({
        "--note-palette-accent": "#059669",
        "--note-palette-light-accent": "#059669",
        "--note-palette-text": "#374151",
        "--note-palette-surface": "#F0FDF4",
        "--note-palette-divider": "#A7F3D0",
        "--note-palette-code-bg": "#ECFDF5",
        "--note-palette-code-text": "#047857",
      })[name] ?? "",
    });
    try {
      const html = [
        "<h2>效率工具箱：斜杠指令、双链与数学公式</h2>",
        "<p>内容一</p>",
        "<h2>多媒体管理、无损备份与零成本自建</h2>",
        "<p>内容二</p>",
      ].join("");
      const root = preparePublishArticle(html, container);
      expect(root.querySelector("[data-ee-cover-card]")).not.toBeNull();
      expect(root.querySelector("[data-ee-cover-card]")?.textContent).toContain("深度评测文章");
      expect(root.querySelector("[data-ee-cover-tags]")).toBeNull();
      expect(root.querySelector("[data-ee-cover-footer]")?.textContent.trim()).toBe("");
      expect(root.querySelector("[data-ee-cover-footer]")?.style.height).toBe("8px");
      const tags = ["开源", "Cloudflare", '<img src=x onerror="alert(1)">', "第四个标签"];
      container.dataset.noteTags = JSON.stringify(tags);
      for (const tagged of [preparePublishArticle(html, container), prepareMarkdownPublishArticle("## 内容\n\n正文", container)]) {
        const label = tagged.querySelector("[data-ee-cover-tags]");
        expect(label?.textContent).toBe(tags.slice(0, 3).join(" · "));
        expect(label?.querySelector("img")).toBeNull();
        expect(css(label)).toContain("overflow-wrap:anywhere");
        expect(tagged.querySelector("[data-ee-cover-footer]")?.textContent.trim()).toBe("");
        expect(tagged.textContent).not.toContain("第四个标签");
        expect(tagged.textContent).not.toContain("精选笔记");
        expect(tagged.textContent).not.toContain("FEATURED");
      }
      container.dataset.noteMagazineCover = "false";
      const bodyCover = preparePublishArticle("<h1>正文标题</h1><p>正文</p>", container);
      expect(bodyCover.querySelector("[data-ee-cover-card]")).toBeNull();
      expect(bodyCover.querySelector("[data-ee-cover-tags]")).toBeNull();
      expect(bodyCover.querySelector("[data-ee-cover-footer]")).toBeNull();
      expect(bodyCover.querySelector("h1")?.textContent).toBe("正文标题");
      expect(bodyCover.querySelectorAll("h1").length).toBe(1);
      container.dataset.noteMagazineCover = "true";
      container.dataset.noteTags = "[]";
      expect(preparePublishArticle(html, container).querySelector("[data-ee-cover-tags]")).toBeNull();

      expect(root.querySelector("[data-ee-toc-cards]")).not.toBeNull();
      expect(root.querySelector("[data-ee-toc-cards]")?.textContent).toContain("2 PARTS");
      const card = root.querySelector('[data-ee-toc-card]');
      expect(css(card)).toContain("background-color:#059669");
      expect(css(card)).toContain("linear-gradient(135deg,");
      expect(css(card)).not.toContain("color-mix");
      const cards = root.querySelectorAll('[data-ee-toc-card]');
      expect(cards.length).toBe(2);
      for (const item of cards) {
        expect(css(item)).not.toContain("height:");
        expect(css(item.parentElement)).toContain("display:flex");
        expect(css(item.parentElement)).toContain("flex-wrap:wrap");
        expect(css(item.parentElement)).toContain("justify-content:flex-start");
        expect(css(item.parentElement)).toContain("gap:8px");
        expect(css(item)).toContain("width:146px");
        expect(css(item)).toContain("max-width:100%");
        expect(css(item)).toContain("flex:0 0 auto");
        expect(css(item)).toContain("min-width:0");
        expect(css(item)).toContain("margin:0");
        expect(css(item.parentElement)).toContain("align-items:stretch");
        expect(css(item)).toContain("box-sizing:border-box");
        expect(css(item)).toContain("padding:12px");
        expect(css(item)).toContain("border:1px solid");
        expect(css(item.querySelector("p"))).toContain("line-height:1.4");
      }

      container.dataset.noteChapterNavigation = "false";
      const coverOnly = preparePublishArticle(html, container);
      expect(coverOnly.querySelector("[data-ee-cover-card]")).not.toBeNull();
      expect(coverOnly.querySelector("[data-ee-toc-cards]")).toBeNull();

      container.dataset.noteMagazineCover = "false";
      const neither = preparePublishArticle(html, container);
      expect(neither.querySelector("[data-ee-cover-card], [data-ee-toc-cards]")).toBeNull();

      container.dataset.noteChapterNavigation = "true";
      const navigationOnly = preparePublishArticle(html, container);
      expect(navigationOnly.querySelector("h1")).toBeNull();
      expect(navigationOnly.querySelector("[data-ee-toc-cards]")).not.toBeNull();
    } finally {
      globalThis.getComputedStyle = previous;
    }
  });
});

describe("formula snapshots for WeChat", () => {
  test("retains a PNG fallback and editable Zhihu source through clipboard HTML serialization", () => {
    const png = "data:image/png;base64,formula-snapshot";
    for (const latex of ["E = mc^2", String.raw`\begin{aligned}a &= b \\ c &= \frac{1}{2}\end{aligned}`, String.raw`\text{\"x\" < y & z}`]) {
      const image = createPublishMathImage(` ${latex} `, png);
      const clipboard = document.createElement("section");
      clipboard.innerHTML = image.outerHTML;
      const pasted = clipboard.querySelector("img.ztext-math[data-tex]");
      expect(pasted?.getAttribute("data-tex")).toBe(latex);
      expect(pasted?.getAttribute("alt")).toBe(latex);
      expect(pasted?.getAttribute("src")).toBe(png);
      expect(clipboard.querySelectorAll("img")).toHaveLength(1);
    }
  });

  test("parks the off-screen offset on a wrapper and snapshots an in-flow mount", async () => {
    const source = await Bun.file(new URL("./wechat-copy.ts", import.meta.url)).text();
    const start = source.indexOf("const placeMathRasterMount");
    const end = source.indexOf("const readCssNumber");
    const raster = source.slice(start, end);
    expect(raster).toContain("mount.style.position = \"static\"");
    expect(raster).toContain("left: -10000px");
    expect(raster).not.toContain("mount.style.left = \"-10000px\"");
    expect(raster).toContain("canvasHasInk");
  });
});

describe("prepareMarkdownPublishArticle", () => {
  test("renders formulas, keeps currency, and colors the shell snippet", () => {
    const root = prepareMarkdownPublishArticle(MARKDOWN);
    const html = root.innerHTML;

    expect(root.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector("[data-ee-math='block'] .katex")).toBeTruthy();
    expect(root.querySelector(".katex-error")).toBeNull();
    const taskList = root.querySelector("[data-ee-task]")?.closest("ul");
    expect(css(taskList)).not.toContain("list-style-type");
    expect(css(taskList)).toContain("list-style:none");
    expect(html).toContain("$10+/月");
    expect(html).toContain("$5+/月");
    expect(html).not.toContain("$E = mc^2$");
    expect(root.querySelector("input[type='checkbox']")).toBeNull();
    expect(root.textContent).toContain("☑ ");
    expect(root.textContent).toContain("☐ ");
    expect(root.textContent).toContain("#\u200bmemo");
    const code = root.querySelector("pre code");
    expect(code?.textContent).toContain("# 官方 GHCR 镜像");
    expect(code?.textContent).not.toContain("#\u200b");
    expect(code?.querySelector("span[style*='#6a737d']")).toBeTruthy();
    expect(css(root.querySelector("blockquote"))).toContain("background:#f3f5f7");
    expect(css(root.querySelector("blockquote p"))).toContain("color:#3d4450");
  });
});
