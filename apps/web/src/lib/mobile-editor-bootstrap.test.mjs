import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const mobileEditorHtml = readFileSync(new URL("../../mobile-edit.html", import.meta.url), "utf8");
const mobileEditorEntry = readFileSync(new URL("../mobile-edit.tsx", import.meta.url), "utf8");
const mobileEditorComponent = readFileSync(
  new URL("../components/MobileStandaloneTiptapEditor.tsx", import.meta.url),
  "utf8"
);
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("standalone mobile editor bootstrap", () => {
  test("keeps a usable loading and recovery surface before React mounts", () => {
    const bootstrapIndex = mobileEditorHtml.indexOf('id="mobile-editor-bootstrap"');
    const moduleIndex = mobileEditorHtml.indexOf('type="module" src="/src/mobile-edit.tsx"');

    expect(bootstrapIndex).toBeGreaterThan(0);
    expect(moduleIndex).toBeGreaterThan(bootstrapIndex);
    expect(mobileEditorHtml).toContain("edgeeverMobileEditorBootstrap");
    expect(mobileEditorHtml).toContain("showFailure");
    expect(mobileEditorHtml).toContain('id="mobile-editor-bootstrap-back"');
    expect(mobileEditorHtml).toContain('id="mobile-editor-bootstrap-retry"');
  });

  test("replaces bootstrap failures with a React recovery boundary after startup", () => {
    expect(mobileEditorEntry).toContain("MobileEditorErrorBoundary");
    expect(mobileEditorEntry).toContain("onUncaughtError");
    expect(mobileEditorEntry).toContain("edgeeverMobileEditorBootstrap?.markMounted()");
  });

  test("does not load desktop syntax highlighting on the mobile editor critical path", () => {
    expect(mobileEditorComponent).toContain("StarterKit.configure({ link: false })");
    expect(mobileEditorComponent).not.toContain("codeBlock: false");
    expect(mobileEditorComponent).not.toContain('from "@/lib/code-block"');
    expect(mobileEditorComponent).not.toContain("codeBlockLowlight");
    expect(viteConfig).toContain(
      'test: /node_modules[\\\\/](?:lowlight|highlight\\.js)[\\\\/]/'
    );
    expect(viteConfig).not.toContain(
      "lowlight|highlight\\.js|@tiptap[\\\\/]extension-code-block-lowlight"
    );
  });
});
