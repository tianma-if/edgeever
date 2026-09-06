import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { enUS } from "../packages/shared/src/i18n/en-US";
import { zhCN } from "../packages/shared/src/i18n/zh-CN";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const editorSource = readSource("../apps/web/src/components/EditorPane.tsx");
const memoListSource = readSource("../apps/web/src/components/MemoListPane.tsx");

describe("note sharing menu", () => {
  test("explains why sharing a newly created local note is disabled", () => {
    expect(zhCN.sharing.afterSync).toBe("同步后可分享笔记");
    expect(enUS.sharing.afterSync).toBe("Share note after sync");
    expect(editorSource).toContain('isLocalMemoId(memo.id) ? "sharing.afterSync"');
    expect(memoListSource).toContain('isLocalMemoId(memoContextMenu.memo.id) ? "sharing.afterSync"');
  });
});
