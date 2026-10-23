import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFDict,
  type PDFRef,
} from "pdf-lib";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

export type PrintOutlineEntry = {
  title: string;
  pageIndex: number;
  /** Distance from the top of the page, as a fraction of the page height. */
  topRatio: number;
  children: PrintOutlineEntry[];
};

type FlatHeading = {
  level: number;
  title: string;
  pageIndex: number;
  topRatio: number;
};

const headingTitle = (element: HTMLElement) => element.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "";

const topRatioWithin = (heading: HTMLElement, page: HTMLElement) => {
  const pageRect = page.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  if (pageRect.height <= 0) return 0;
  const ratio = (headingRect.top - pageRect.top) / pageRect.height;
  return Math.min(1, Math.max(0, ratio));
};

const nestHeadings = (headings: readonly FlatHeading[]): PrintOutlineEntry[] => {
  const roots: PrintOutlineEntry[] = [];
  const ancestors: Array<{ level: number; entry: PrintOutlineEntry }> = [];

  for (const heading of headings) {
    const entry: PrintOutlineEntry = {
      title: heading.title,
      pageIndex: heading.pageIndex,
      topRatio: heading.topRatio,
      children: [],
    };
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.level >= heading.level) ancestors.pop();
    const parent = ancestors[ancestors.length - 1];
    if (parent) parent.entry.children.push(entry);
    else roots.push(entry);
    ancestors.push({ level: heading.level, entry });
  }

  return roots;
};

/** Headings in the paginated preview, in the same order as the editor outline. */
export const collectPrintOutline = (root: Pick<ParentNode, "querySelectorAll">): PrintOutlineEntry[] => {
  const pages = [...root.querySelectorAll<HTMLElement>(".pagedjs_page")];
  const headings: FlatHeading[] = [];

  pages.forEach((page, pageIndex) => {
    for (const heading of page.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
      if (heading.hasAttribute("data-split-from")) continue;
      const title = headingTitle(heading);
      if (!title) continue;
      headings.push({
        level: Number(heading.tagName.slice(1)) || 1,
        title,
        pageIndex,
        topRatio: topRatioWithin(heading, page),
      });
    }
  });

  return nestHeadings(headings);
};

const descendantCount = (entry: PrintOutlineEntry): number =>
  entry.children.reduce((sum, child) => sum + 1 + descendantCount(child), 0);

/** Writes the viewer's sidebar outline. Positive counts leave the entries expanded. */
export const addPdfOutline = (pdf: PDFDocument, entries: readonly PrintOutlineEntry[]) => {
  if (entries.length === 0 || pdf.getPageCount() === 0) return;
  const pages = pdf.getPages();
  const context = pdf.context;
  const outlines = context.obj({});
  const outlinesRef = context.register(outlines);

  const writeLevel = (nodes: readonly PrintOutlineEntry[], parentRef: PDFRef) => {
    let previous: PDFRef | null = null;
    let first: PDFRef | null = null;
    let last: PDFRef | null = null;

    for (const node of nodes) {
      const item = context.obj({});
      const ref = context.register(item);
      first ??= ref;
      last = ref;
      const page = pages[Math.min(node.pageIndex, pages.length - 1)]!;
      const y = page.getHeight() * (1 - node.topRatio);
      item.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
      item.set(PDFName.of("Parent"), parentRef);
      item.set(PDFName.of("Dest"), context.obj([
        page.ref,
        PDFName.of("XYZ"),
        PDFNull,
        PDFNumber.of(y),
        PDFNull,
      ]));

      const children = writeLevel(node.children, ref);
      if (children) {
        item.set(PDFName.of("First"), children.first);
        item.set(PDFName.of("Last"), children.last);
        item.set(PDFName.of("Count"), PDFNumber.of(descendantCount(node)));
      }
      if (previous) {
        (context.lookup(previous) as PDFDict).set(PDFName.of("Next"), ref);
        item.set(PDFName.of("Prev"), previous);
      }
      previous = ref;
    }

    return first && last ? { first, last } : null;
  };

  const top = writeLevel(entries, outlinesRef);
  if (!top) return;
  outlines.set(PDFName.of("Type"), PDFName.of("Outlines"));
  outlines.set(PDFName.of("First"), top.first);
  outlines.set(PDFName.of("Last"), top.last);
  outlines.set(PDFName.of("Count"), PDFNumber.of(entries.reduce((sum, entry) => sum + 1 + descendantCount(entry), 0)));
  pdf.catalog.set(PDFName.of("Outlines"), outlinesRef);
};
