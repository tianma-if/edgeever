import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "../../../../../packages/shared/src/i18n/zh-CN.ts";
import { AiSidebarLocalProcess } from "./AiSidebarLocalProcess.tsx";

const renderProcess = async (props) => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } } });
  return renderToStaticMarkup(createElement(
    I18nextProvider,
    { i18n },
    createElement(AiSidebarLocalProcess, props),
  ));
};

describe("local agent thinking process", () => {
  test("opens streamed reasoning while the agent is still thinking", async () => {
    const markup = await renderProcess({
      reasoning: "先按名称和价格把 12 个节点对齐。",
      tools: [{ id: "tool-1", name: "view_file", status: "in_progress", title: "查看当前笔记" }],
      running: true,
    });
    expect(markup).toContain("思考过程");
    expect(markup).toContain("先按名称和价格把 12 个节点对齐。");
    expect(markup).toContain('data-state="open"');
    expect(markup).not.toContain('data-state="closed"');
  });

  test("starts collapsed once the answer is already on screen", async () => {
    const markup = await renderProcess({
      reasoning: "先按名称和价格把 12 个节点对齐。",
      tools: [],
      running: true,
      answering: true,
    });
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toContain('data-state="open"');
  });

  test("keeps a finished turn collapsed", async () => {
    const markup = await renderProcess({
      reasoning: "已经对过价格。",
      tools: [],
      running: false,
    });
    expect(markup).toContain("思考过程");
    expect(markup).toContain('data-state="closed"');
    expect(markup).not.toContain('data-state="open"');
  });
});
