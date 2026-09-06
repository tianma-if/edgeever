import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { zhCN } from "../../../../packages/shared/src/i18n/zh-CN.ts";
import { enUS } from "../../../../packages/shared/src/i18n/en-US.ts";
import { TooltipProvider } from "./ui/tooltip.tsx";
import Hub from "./CompanionDiscoveryHub.tsx";
import { CompanionDiscoverySettingsCard } from "./settings/CompanionDiscoverySettingsCard.tsx";
import { discoverySettingsKey, discoveryFeedKey } from "../hooks/useCompanionDiscovery.ts";

async function render(enabled, locale = "zh-CN", card = false, settings = {}, items = [], aiReady = true) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(discoverySettingsKey("test"), { enabled, version: 0, lastCheckAt: null, lastStatus: "quiet", ...settings });
  client.setQueryData(discoveryFeedKey("test"), items);
  client.setQueryData(["ai-settings", locale], { defaultModelId: aiReady ? "default" : null,
    providers: aiReady ? [{ isEnabled: true, models: [{ id: "default" }] }] : [], encryptionConfigured: true });
  const i18n = createInstance(); await i18n.init({ lng: locale, resources: { "zh-CN": { translation: zhCN }, "en-US": { translation: enUS } } });
  const component = card ? createElement(CompanionDiscoverySettingsCard, { scope: "test", onOpenCompanion() {}, onOpenAiSettings() {} })
    : createElement(Hub, { scope: "test", onOpenNote() {}, async onNotesChanged() {}, onOpenSettings() {} });
  const result = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(QueryClientProvider, { client }, createElement(TooltipProvider, {}, component))));
  client.clear(); return result;
}
describe("quiet discovery UI", () => {
  test("disabled hides the Paw mode entry and panel", async () => {
    const html = await render(false);
    expect(html).toBe("");
    expect(html).not.toContain("lucide-paw-print");
  });
  test("enabled shows only a quiet paw, not an automatically opened dialog", async () => {
    const html = await render(true);
    expect(html).toContain('aria-label="来自猫爪的发现"');
    expect(html).toContain("lucide-paw-print");
    expect(html).not.toContain("lucide-bell");
    expect(html).not.toContain("fixed bottom-24");
    expect(html).not.toContain('role="dialog"'); expect(html).not.toContain("有新发现");
  });
  test("Paw mode explains benefits and offers separate learning and memory controls", async () => {
    const html = await render(false, "zh-CN", true);
    expect(html).toContain("开启后，EdgeEver 会像猫爪轻推纸片一样，帮你归拢零散碎片、将新想法沉淀到已有笔记、挑出过往的相关灵感。");
    expect(html).toContain("用得越久，猫爪越懂你。");
    expect(html).toContain("猫爪模式");
    expect(html).toContain("猫爪状态"); expect(html).toContain("未运行");
    expect(html).toContain("尚未检查"); expect(html).toContain("启用后才会检查");
    expect(html).toContain("从操作中学习"); expect(html).toContain("使用已保存的记忆");
    expect(html).toContain('id="paw-learningEnabled"'); expect(html).toContain('id="paw-useMemory"');
    expect(html).toContain('role="switch"'); expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('role="checkbox"'); expect(html).not.toContain("<fieldset");
    expect(html).toContain("对话与个人记忆");
  });
  test("enabled settings show the real check state and latest generated discovery", async () => {
    const html = await render(true, "zh-CN", true,
      { lastStatus: "ready", lastCheckAt: "2026-09-04T06:30:00.000Z" },
      [{ id: "discovery", kind: "insight", title: "两个产品想法可以互相补充", body: "早期记录解释了新方案的取舍。",
        sources: [], action: null, seen: false, createdAt: "2026-09-04T06:30:00.000Z" }]);
    expect(html).toContain("最近检查完成"); expect(html).toContain("最近检查"); expect(html).toContain("下次检查");
    expect(html).toContain("最近发现"); expect(html).toContain("两个产品想法可以互相补充");
    expect(html).toContain("早期记录解释了新方案的取舍。"); expect(html).not.toContain("个性化偏好");
  });
  test("shows the AI model prerequisite before Paw mode can be enabled", async () => {
    const html = await render(false, "zh-CN", true, {}, [], false);
    expect(html).toContain("开启猫爪模式前，请先配置并启用默认 AI 模型。");
    expect(html).toContain("前往 AI 集成");
  });
  test("English settings have matching concise benefits and no raw translation keys", async () => {
    const html = await render(false, "en-US", true);
    expect(html).toContain("When enabled, EdgeEver quietly helps tuck scattered fragments together, append new ideas to existing notes, and surface relevant past insights like a gentle cat paw.");
    expect(html).toContain("The longer you use it, the better Paw mode understands you.");
    expect(html).toContain("Paw status"); expect(html).toContain("Not running");
    expect(html).not.toContain("Personal preferences"); expect(html).not.toContain("one minute");
    expect(html).not.toContain("companion.discovery."); expect(html).toContain("Paw mode");
  });
  test("checks are event-driven, sync-gated and cancel on cleanup", () => {
    const source = readFileSync(new URL("./CompanionDiscoveryHub.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("setInterval"); expect(source).not.toContain("new Notification");
    expect(source).toContain("const DISCOVERY_IDLE_DELAY_MS = 3 * 60_000");
    expect(source).toContain("attemptedSinceWorkspaceChange");
    expect(source).toContain("scheduleAfterWorkspaceChange");
    expect(source).toContain('document.visibilityState !== "visible"'); expect(source).toContain("await assertCompanionChangesSynced(scope)");
    expect(source).toContain("stop.abort()"); expect(source).toContain("IntersectionObserver");
    expect(source).not.toContain("companion.discovery.kind.");
    expect(source).not.toContain("companion.discovery.types.");
    expect(source).not.toContain("companion.discovery.panelDescription");
    expect(source).not.toContain("companion.discovery.tagline");
  });
  test("composes the discovery panel from shared shadcn UI primitives", () => {
    const source = readFileSync(new URL("./CompanionDiscoveryHub.tsx", import.meta.url), "utf8");
    expect(source).toContain('from "@/components/ui/card"');
    expect(source).toContain('from "@/components/ui/badge"');
    expect(source).toContain('from "@/components/ui/alert"');
    expect(source).toContain("<Card");
    expect(source).toContain("<Badge");
    expect(source).toContain('<Alert variant="destructive"');
  });
});
