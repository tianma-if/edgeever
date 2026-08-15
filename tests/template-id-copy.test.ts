import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const templatesPaneSource = readFileSync(
  new URL("../apps/web/src/components/TemplatesPane.tsx", import.meta.url),
  "utf8",
);

describe("copy note template ID", () => {
  test("copies the raw persisted template ID from every template card", () => {
    expect(templatesPaneSource).toContain("copyTextToClipboard(template.id)");
    expect(templatesPaneSource).toContain('label={t("templates.copyId")}');
    expect(templatesPaneSource).toContain('"templates.idCopied"');
    expect(templatesPaneSource).toContain("<ClipboardCopyNotice");
  });
});
