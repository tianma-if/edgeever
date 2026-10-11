import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";

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

beforeAll(async () => {
  const module = await import("./wechat-copy.ts");
  preparePublishArticle = module.preparePublishArticle;
  prepareMarkdownPublishArticle = module.prepareMarkdownPublishArticle;
});

const MARKDOWN = `
> **EdgeEver** 把笔记留在你自己的账号里。

正文里的行内代码是 \`#memo=<笔记ID>\`，起步价（$10+/月）。

| 成本 | 商业订阅高昂（$10+/月） | 官方云同步收费（$5+/月） |
| --- | --- | --- |

- **行内公式**：例如质能方程 $E = mc^2$。
- **多行独立公式块**：
$$
\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV
$$

- [x] 已完成的待办
- [ ] 未完成的待办

\`\`\`sh
# 官方 GHCR 镜像
curl -fsSL https://edgeever.org/install.sh | bash
\`\`\`
`;

describe("preparePublishArticle", () => {
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
    ].join(""));

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
    expect(css(inlineCode)).toContain("color:#3d4450");
    expect(css(inlineCode)).toContain("background:#f3f5f7");
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
});

describe("formula snapshots for WeChat", () => {
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
