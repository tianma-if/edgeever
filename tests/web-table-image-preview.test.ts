import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("table image attachment actions", () => {
  test("opens an image from its thumbnail and keeps copy and download on hover", () => {
    // Cells moved into their own module; the contract still has to hold there.
    const source = readSource("../apps/web/src/components/table/table-cells.tsx");
    expect(source).toContain("const isImageAttachment = (item: TableAttachment) => item.mimeType.toLowerCase().startsWith(\"image/\");");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('t("structuredTable.openAttachment"');
    expect(source).toContain("group-hover/attachment:flex group-focus-within/attachment:flex");
    expect(source).toContain("copyImageUrlToClipboard");
    expect(source).toContain('t("structuredTable.copyImage")');
    expect(source).toContain('t("structuredTable.downloadAttachment"');
    expect(source).not.toContain("ImageViewer");
    expect(source).not.toContain("openInNewWindow");
    const pane = readSource("../apps/web/src/components/TableEditorPane.tsx");
    expect(pane).toContain('} from "@/components/table/table-cells";');
  });

  test("names the image actions in every locale", () => {
    for (const locale of ["zh-CN", "en-US", "ja"]) {
      const source = readSource(`../packages/shared/src/i18n/${locale}.ts`);
      expect(source).toContain("openAttachment:");
      expect(source).toContain("copyImage:");
      expect(source).toContain("imageCopied:");
      expect(source).toContain("downloadAttachment:");
    }
  });
});
