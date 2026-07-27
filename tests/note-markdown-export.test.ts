import { describe, expect, test } from "bun:test";
import {
  buildMarkdownFilename,
  createMarkdownFile,
} from "../apps/web/src/lib/note-markdown-export";

describe("single-note Markdown export", () => {
  test("creates a UTF-8 Markdown file with the current content", async () => {
    const file = createMarkdownFile("# 标题\n\n当前未保存内容", "项目 / 计划", "Untitled note");

    expect(file.filename).toBe("项目 - 计划.md");
    expect(file.blob.type).toBe("text/markdown;charset=utf-8");
    expect(await file.blob.text()).toBe("# 标题\n\n当前未保存内容");
  });

  test("sanitizes unsafe and reserved filenames", () => {
    expect(buildMarkdownFilename("CON", "Untitled note")).toBe("_CON.md");
    expect(buildMarkdownFilename('<>:"/\\|?*', "Untitled note")).toBe("---------.md");
    expect(buildMarkdownFilename("...", "Untitled note")).toBe("Untitled note.md");
    expect(buildMarkdownFilename("README.md", "Untitled note")).toBe("README.md");
  });
});
