import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { addPdfOutline, collectPrintOutline } from "./note-print-outline.ts";

const rect = (top, height) => () => ({
  top, height, left: 0, width: 100, right: 100, bottom: top + height, x: 0, y: top, toJSON() { return {}; },
});

const outlineTitles = (pdf) => {
  const titles = [];
  const seen = new Set();
  const visit = (ref) => {
    if (!ref || seen.has(ref.toString())) return;
    seen.add(ref.toString());
    const item = pdf.context.lookup(ref);
    const title = item.get?.(PDFName.of("Title"));
    if (title instanceof PDFHexString) titles.push(title.decodeText());
    visit(item.get?.(PDFName.of("First")));
    visit(item.get?.(PDFName.of("Next")));
  };
  visit(pdf.catalog.get(PDFName.of("Outlines")) && pdf.context.lookup(pdf.catalog.get(PDFName.of("Outlines"))).get(PDFName.of("First")));
  return titles;
};

describe("print PDF outline", () => {
  test("nests body headings under the note title and records where they sit", () => {
    const { document } = parseHTML("<!doctype html><body></body>");
    document.body.innerHTML = `
      <div class="pagedjs_page"><h1>欢迎使用 EdgeEver</h1><h2>概览</h2><h2>海报</h2><h3>排版定制</h3></div>
      <div class="pagedjs_page"><h2 data-split-from="1">海报</h2><h2>表达力</h2></div>
    `;
    for (const page of document.querySelectorAll(".pagedjs_page")) page.getBoundingClientRect = rect(0, 1000);
    const headings = [...document.querySelectorAll("h1, h2, h3")];
    headings[0].getBoundingClientRect = rect(40, 30);
    headings[1].getBoundingClientRect = rect(200, 20);
    headings[2].getBoundingClientRect = rect(400, 20);
    headings[3].getBoundingClientRect = rect(460, 20);
    headings[5].getBoundingClientRect = rect(80, 20);

    expect(collectPrintOutline(document)).toEqual([
      {
        title: "欢迎使用 EdgeEver",
        pageIndex: 0,
        topRatio: 0.04,
        children: [
          { title: "概览", pageIndex: 0, topRatio: 0.2, children: [] },
          {
            title: "海报",
            pageIndex: 0,
            topRatio: 0.4,
            children: [{ title: "排版定制", pageIndex: 0, topRatio: 0.46, children: [] }],
          },
          { title: "表达力", pageIndex: 1, topRatio: 0.08, children: [] },
        ],
      },
    ]);
  });

  test("writes expanded sidebar entries that point at the heading page", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 200]);
    pdf.addPage([100, 200]);
    addPdfOutline(pdf, [{
      title: "欢迎使用 EdgeEver",
      pageIndex: 0,
      topRatio: 0,
      children: [{ title: "表达力", pageIndex: 1, topRatio: 0.25, children: [] }],
    }]);
    const saved = await PDFDocument.load(await pdf.save());
    expect(outlineTitles(saved)).toEqual(["欢迎使用 EdgeEver", "表达力"]);
    const outlines = saved.context.lookup(saved.catalog.get(PDFName.of("Outlines")));
    expect(outlines.get(PDFName.of("Count")).asNumber()).toBe(2);
  });
});
