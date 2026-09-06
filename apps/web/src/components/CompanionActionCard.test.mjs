import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "../../../../packages/shared/src/i18n/zh-CN.ts";
import { enUS } from "../../../../packages/shared/src/i18n/en-US.ts";
import { CompanionActionCard } from "./CompanionActionCard.tsx";

const action = {
  id: "action", turnId: "turn", plan: { kind: "merge", memoIds: ["a", "b"], title: "Ideas", reason: "Two pieces of one idea" },
  notes: ["a", "b"].map(id => ({ id, title: id, revision: 0, notebookId: "nb", updatedAt: "now", tags: ["original"], excerpt: `Idea ${id}` })),
  status: "pending", resultMemoId: null, createdAt: "now",
};
async function render(overrides = {}, busy = false, lng = "zh-CN") {
  const i18n = createInstance();
  await i18n.init({ lng, resources: { "zh-CN": { translation: zhCN }, "en-US": { translation: enUS } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(CompanionActionCard, {
    action: { ...action, ...overrides }, busy, onApply() {}, onDismiss() {}, onOpenNote() {},
  })));
}
describe("companion suggestion cards", () => {
  test("keeps merging behind an explicit preview with source order", async () => {
    const html = await render();
    expect(html).toContain("合并后的标题：Ideas");
    expect(html).toContain(">确认<");
    expect(html).not.toContain("原公开分享失效");
    expect(html).not.toContain("建议 24 小时后失效");
    expect(html.indexOf("Idea a")).toBeLessThan(html.indexOf("Idea b"));
  });
  test("shows additive tags and preserves existing tag disclosure", async () => {
    const html = await render({ plan: { kind: "tag", memoId: "a", tags: ["new"], reason: "One project" }, notes: action.notes.slice(0, 1) });
    expect(html).toContain("已有标签：original");
    expect(html).toContain("仅追加：new");
    expect(html).toContain(">确认<");
    expect(html).not.toContain("只给这篇笔记追加列出的标签");
    expect(html).not.toContain("建议 24 小时后失效");
    expect(html).not.toContain("确认追加标签");
  });
  test("applied or invalid proposals cannot be confirmed again", async () => {
    expect(await render({ status: "applied", resultMemoId: "merged" })).toContain("打开处理后的笔记");
    for (const status of ["applied", "dismissed", "unavailable", "uncertain"]) {
      expect(await render({ status })).not.toContain(">确认<");
    }
  });
  test("generic tool cards disclose exact replacements, targets and irreversible effects", async () => {
    const html = await render({ plan: { kind: "tool", toolName: "update_memo", reason: "Requested edit",
      arguments: { memoId: "a", contentMarkdown: "Exact replacement <script>alert(1)</script>", tags: ["new"] } },
      preview: { notebooks: [], affectedCount: 1 } });
    expect(html).toContain("修改笔记");
    expect(html).toContain("写入的完整正文");
    expect(html).toContain("不是追加操作");
    expect(html).toContain(">确认<");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  test("generic uncertain and applied receipts never offer a second execution", async () => {
    for (const status of ["applied", "uncertain", "dismissed", "unavailable"]) {
      const html = await render({ plan: { kind: "tool", toolName: "create_memo", arguments: { title: "New" }, reason: "Requested" },
        notes: [], status, resultMemoId: "new", resultNotebookId: "nb", result: { memoId: "new" } }, false, "en-US");
      expect(html).not.toContain(">Confirm<");
      expect(html).not.toContain("companion.actions.");
      if (status === "applied") expect(html).toContain("Open updated note");
      if (status === "uncertain") expect(html).toContain("will not run again");
    }
  });
  test("global tag operations show the account-wide effect and resolved notebook names", async () => {
    const html = await render({ plan: { kind: "tool", toolName: "rename_tag", arguments: { from: "old", to: "new" }, reason: "Unify vocabulary" },
      preview: { notebooks: [], affectedCount: 42 } });
    expect(html).toContain("42");
    expect(html).toContain("所有使用这个标签的笔记");
  });
  test("disables actions while busy without extra English help copy", async () => {
    const html = await render({}, true, "en-US");
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("their public shares are revoked");
    expect(html).not.toContain("companion.actions.");
  });
});
