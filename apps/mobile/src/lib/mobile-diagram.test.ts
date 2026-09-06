import { describe, expect, test } from "bun:test";
import { createDefaultDiagramDocument, serializeDiagramDocument } from "@edgeever/shared";
import { getMobileVisualDiagramKind, resolveMobileMemoViewerContent } from "./mobile-diagram";

describe("mobile visual diagram viewer", () => {
  test.each(["mind-map", "flowchart", "architecture"] as const)("projects a %s envelope into a Mermaid node", (kind) => {
    const serialized = serializeDiagramDocument(createDefaultDiagramDocument(kind));
    const marker = serialized.slice(serialized.indexOf("<!-- edgeever-diagram-v1:"));
    const legacyMarkdown = `# legacy\n\n- node list only\n\n${marker}`;
    const doc = resolveMobileMemoViewerContent(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "node list only" }] }] },
      legacyMarkdown,
    );
    expect(doc.content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "mermaid")).toBe(true);
    if (kind === "architecture") {
      const mermaid = doc.content?.find((node) => node.type === "codeBlock")?.content?.[0]?.text;
      expect(mermaid).toContain('subgraph n0["应用系统"]');
      expect(mermaid).toContain("shape: cyl");
    }
  });

  test("keeps visual diagram envelopes out of the regular native editor", () => {
    const architecture = serializeDiagramDocument(createDefaultDiagramDocument("architecture"));
    expect(getMobileVisualDiagramKind(architecture)).toBe("architecture");
    expect(getMobileVisualDiagramKind("# Ordinary note")).toBeNull();
  });
});
