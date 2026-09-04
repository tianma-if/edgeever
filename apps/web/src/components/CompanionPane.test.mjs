import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "../../../../packages/shared/src/i18n/zh-CN.ts";
import { enUS } from "../../../../packages/shared/src/i18n/en-US.ts";
import CompanionPane from "./CompanionPane.tsx";

const renderPane = async (available, locale = "zh-CN") => {
  const i18n = createInstance();
  await i18n.init({ lng: locale, resources: { "zh-CN": { translation: zhCN }, "en-US": { translation: enUS } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(CompanionPane, {
    available, onBack() {}, onOpenSettings() {},
  })));
};

describe("companion workspace", () => {
  test("renders a standalone page with chat, memory controls, and an explicit return to notes", async () => {
    const markup = await renderPane(true);
    expect(markup).toContain('aria-labelledby="companion-title"');
    expect(markup).toContain("返回笔记");
    expect(markup).toContain("她记得的事");
    expect(markup).toContain('id="companion-message"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("默认模型服务商");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain('aria-modal="true"');
  });

  test("explains unavailable personal data without rendering the chat workspace", async () => {
    const markup = await renderPane(false);
    expect(markup).toContain("与 EdgeEver 聊聊");
    expect(markup).toContain("暂不读取或保存个人记忆");
    expect(markup).not.toContain('id="companion-message"');
    expect(markup).not.toContain("她记得的事");
  });

  test("provides the same availability and navigation guidance in English", async () => {
    const markup = await renderPane(false, "en-US");
    expect(markup).toContain("Chat with EdgeEver");
    expect(markup).toContain("Back to notes");
    expect(markup).toContain("Personal memories are not read or saved");
    expect(markup).not.toContain("companion.");
  });

  test("is routed and lazy-loaded independently of the prompt library", () => {
    const workspace = readFileSync(new URL("./WorkspaceApp.tsx", import.meta.url), "utf8");
    const routes = readFileSync(new URL("../app/App.tsx", import.meta.url), "utf8");
    const prompts = readFileSync(new URL("./AiPromptsPane.tsx", import.meta.url), "utf8");
    expect(workspace).toContain('const CompanionPane = lazy(() => import("./CompanionPane"))');
    expect(workspace).toContain('available={authRequired && Boolean(user) && !demoMode}');
    expect(workspace).toContain('<CompanionPane key={localDataScope}');
    expect(workspace).toContain('!route.isCompanion && rightView !== "companion"');
    expect(workspace).toContain('if (returningFromCompanion) setActivePane("memos")');
    expect(routes).toContain('<Route path="/companion" element={<AuthenticatedWorkspace />} />');
    expect(prompts).not.toMatch(/companion/i);
  });
});
