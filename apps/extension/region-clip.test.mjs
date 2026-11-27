import { expect, test } from "bun:test";
import { createWindow } from "@mixmark-io/domino";

test("region conversion preserves only chosen visible content and does not alter the source DOM", async () => {
  const { regionMarkdown } = await import("./src/region-selection");
  const window = createWindow('<title>Page</title><nav>Outside navigation</nav><section id="chosen"><h2>Chosen heading</h2><p aria-hidden="true">正文</p><p style="display:none">不应出现</p><p>Text <a href="/link">link</a></p><table><tr><th>A</th></tr><tr><td>Cell</td></tr></table><pre><code>line 1\n\nline 2</code></pre><img src="/photo.png"><p hidden>Hidden text</p><script>bad()</script><input value="private"><div id="edgeever-region-picker">Picker controls</div></section><aside>Outside recommendations</aside>', "https://example.test/story");
  const original = window.document.documentElement.outerHTML;
  const markdown = regionMarkdown(window.document.getElementById("chosen"), window.location.href);
  for (const expected of ["## Chosen heading", "正文", "[link](https://example.test/link)", "Cell", "line 1\n\nline 2", "https://example.test/photo.png"]) expect(markdown).toContain(expected);
  for (const excluded of ["Outside", "不应出现", "Hidden text", "bad()", "private", "Picker controls"]) expect(markdown).not.toContain(excluded);
  expect(window.document.documentElement.outerHTML).toBe(original);
});

test("shrinking a table or code block keeps indivisible Markdown containers intact", async () => {
  const { RegionSelection, regionMarkdown, regionWrapper } = await import("./src/region-selection");
  const window = createWindow('<section id="chosen"><table id="tbl"><caption id="cap">Summary</caption><tbody id="body"><tr id="row"><th id="h1">H1</th><th id="h2">H2</th></tr><tr><td>A</td><td>B</td></tr></tbody></table><pre id="pre"><code id="code"><span id="kw">const</span> <span id="expr"><span id="ident">line</span> = 1;</span>\n\n<span id="ret">line 2</span></code></pre></section>', "https://example.test/story");
  for (const element of Array.from(window.document.querySelectorAll("*"))) {
    const width = element.tagName === "SPAN" ? 36 : 120;
    const height = element.tagName === "SPAN" ? 16 : 40;
    element.getBoundingClientRect = () => ({ width, height, left: 0, top: 0, right: width, bottom: height });
  }
  const tableSelection = new RegionSelection(regionWrapper(window.document.getElementById("h1")));
  expect(tableSelection.element.id).toBe("tbl");
  expect(tableSelection.canShrink).toBe(true);
  tableSelection.child();
  expect(tableSelection.element.id).toBe("cap");
  tableSelection.sibling("nextElementSibling");
  expect(tableSelection.element.id).toBe("cap");

  const bodyTable = createWindow('<section><table id="tbl"><tbody id="body"><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></tbody></table><p>Other</p></section>', "https://example.test/story");
  for (const element of Array.from(bodyTable.document.querySelectorAll("*"))) {
    element.getBoundingClientRect = () => ({ width: 120, height: 40, left: 0, top: 0, right: 120, bottom: 40 });
  }
  const wholeTable = new RegionSelection(regionWrapper(bodyTable.document.querySelector("td")));
  expect(wholeTable.element.id).toBe("tbl");
  expect(wholeTable.canShrink).toBe(false);
  wholeTable.child();
  expect(wholeTable.element.id).toBe("tbl");
  expect(regionMarkdown(wholeTable.element, "https://example.test/story")).toBe("| H1  | H2  |\n| --- | --- |\n| A   | B   |");

  for (const targetId of ["code", "kw", "ident"]) {
    expect(regionWrapper(window.document.getElementById(targetId)).id).toBe("pre");
  }
  const codeSelection = new RegionSelection(regionWrapper(window.document.getElementById("ident")));
  expect(codeSelection.element.id).toBe("pre");
  expect(codeSelection.canShrink).toBe(false);
  codeSelection.child();
  expect(codeSelection.element.id).toBe("pre");
  expect(regionMarkdown(codeSelection.element, "https://example.test/story")).toBe("```\nconst line = 1;\n\nline 2\n```");
});

test("region conversion includes aria-hidden selected text and still removes CSS-hidden text", async () => {
  const { regionMarkdown } = await import("./src/region-selection");
  const window=createWindow('<section id="chosen"><p aria-hidden="true">正文</p><p style="display:none">不应出现</p></section>',"https://example.test/story");
  const markdown=regionMarkdown(window.document.getElementById("chosen"),window.location.href);
  expect(markdown).toContain("正文"); expect(markdown).not.toContain("不应出现");
});
