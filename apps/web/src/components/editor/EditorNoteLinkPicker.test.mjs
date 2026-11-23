import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "../../../../../packages/shared/src/i18n/zh-CN.ts";
import { enUS } from "../../../../../packages/shared/src/i18n/en-US.ts";
import { formatMemoCreatedAtLabel } from "../../../../../packages/shared/src/memo-title.ts";
import { EditorNoteLinkPicker } from "./EditorNoteLinkPicker.tsx";

const memo = (overrides) => ({
  id: "memo-1",
  title: "项目笔记",
  excerpt: "项目摘要",
  isDeleted: false,
  createdAt: "2026-11-06T16:03:05.000Z",
  ...overrides,
});

async function render(memos, lng = "en-US") {
  const i18n = createInstance();
  await i18n.init({ lng, resources: { "zh-CN": { translation: zhCN }, "en-US": { translation: enUS } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(EditorNoteLinkPicker, {
    query: "",
    isLoading: false,
    memos,
    currentMemoId: "current",
    onQueryChange: () => {},
    onClose: () => {},
    onInsert: () => {},
  })));
}

describe("editor note link picker", () => {
  test("shows the creation-time label for untitled notes", async () => {
    const first = formatMemoCreatedAtLabel("2026-11-06T16:03:05.000Z", "en-US");
    const second = formatMemoCreatedAtLabel("2026-11-06T16:03:47.000Z", "en-US");
    const html = await render([
      memo({ id: "first", title: "", createdAt: "2026-11-06T16:03:05.000Z" }),
      memo({ id: "second", title: "", createdAt: "2026-11-06T16:03:47.000Z" }),
      memo({ id: "titled", title: "项目笔记" }),
    ]);
    expect(first).not.toBe(second);
    expect(html).toContain(first);
    expect(html).toContain(second);
    expect(html).toContain("项目笔记");
    expect(html).not.toContain("Untitled note");
  });

  test("falls back to the untitled label when the creation time is unusable", async () => {
    const html = await render([memo({ id: "nodate", title: "", createdAt: "" })]);
    expect(html).toContain("Untitled note");
  });
});
