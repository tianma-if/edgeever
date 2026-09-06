import { describe, expect, test } from "bun:test";
import { insertAiDraftAtTextCursor } from "./ai-draft-insertion.ts";

describe("AI draft insertion", () => {
  test("inserts generated content at the captured cursor instead of the note end", () => {
    expect(insertAiDraftAtTextCursor("第一段\n\n第三段", "第二段", 3)).toEqual({
      next: "第一段\n\n第二段\n\n第三段",
      caret: 8,
    });
  });

  test("separates generated block content when the cursor is inside a line", () => {
    expect(insertAiDraftAtTextCursor("前半后半", "插入", 2)).toEqual({
      next: "前半\n\n插入\n\n后半",
      caret: 8,
    });
  });
});
