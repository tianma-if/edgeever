import { afterEach, expect, test } from "bun:test";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { enUS, zhCN } from "@edgeever/shared/i18n";
import { AI_SIDEBAR_ADAPTER_KEY, AI_SIDEBAR_ADAPTER_PATH_KEY, AI_SIDEBAR_SOURCE_KEY } from "@/lib/desktop-acp";
import { DesktopAcpAgentCard } from "./DesktopAcpAgentCard.tsx";

const globals = ["window", "document", "localStorage", "Event", "Node", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let root;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const createMemoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
  };
};

const mountCard = async ({ initialPath = "/custom/bin/agy", chooseAcpAdapterPath, clearAcpAdapterPath } = {}) => {
  const { window } = parseHTML("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
  const storage = createMemoryStorage({
    [AI_SIDEBAR_SOURCE_KEY]: "local",
    [AI_SIDEBAR_ADAPTER_KEY]: "antigravity",
    [AI_SIDEBAR_ADAPTER_PATH_KEY]: initialPath,
  });
  let currentCustomPath = initialPath;
  window.localStorage = storage;
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  window.edgeeverDesktop = {
    isAvailable: true,
    listAcpAdapters: async () => [{
      id: "antigravity",
      label: "Antigravity",
      state: "not_probed",
      detail: "not_probed",
      ...(currentCustomPath ? { customPath: currentCustomPath } : {}),
    }],
    chooseAcpAdapterPath: async () => {
      const result = await chooseAcpAdapterPath();
      if (result) currentCustomPath = result;
      return result;
    },
    clearAcpAdapterPath: async () => {
      const result = await clearAcpAdapterPath();
      if (result) currentCustomPath = "";
      return result;
    },
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = storage;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
  const container = window.document.getElementById("root");
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(DesktopAcpAgentCard)));
  });
  await act(async () => {
    await Promise.resolve();
  });

  const findButton = (label) => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
  const pathInput = () => container.querySelector(`input[aria-label="${enUS.aiAssistant.agentSource.pathLabel}"]`);
  const alertEl = () => container.querySelector('[role="alert"]');
  return { container, findButton, pathInput, alertEl };
};

test("desktop and hidden mobile cards have independent native radio groups", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } } });
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(Fragment, null, createElement(DesktopAcpAgentCard), createElement(DesktopAcpAgentCard))));
  const names = [...html.matchAll(/name="(edgeever-acp-source-[^"]+)"/g)].map((match) => match[1]);
  expect(names).toHaveLength(4);
  expect(names[0]).toBe(names[1]);
  expect(names[2]).toBe(names[3]);
  expect(names[0]).not.toBe(names[2]);
});

test("Antigravity path clear keeps controls pending and reports false or rejected clears without mutating the path", async () => {
  let pendingClear = deferred();
  let clearMode = "false";
  const ui = await mountCard({
    initialPath: "/custom/bin/agy",
    chooseAcpAdapterPath: async () => null,
    clearAcpAdapterPath: () => {
      pendingClear = deferred();
      return pendingClear.promise;
    },
  });

  expect(ui.pathInput()?.value).toBe("/custom/bin/agy");
  expect(ui.alertEl()).toBeNull();

  // Click Clear -> stays pending and disables Choose/Clear/Probe.
  const clearButton = ui.findButton(enUS.aiAssistant.agentSource.clearPath);
  expect(clearButton).toBeTruthy();
  await act(async () => {
    clearButton.click();
  });
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearingPath)?.disabled).toBe(true);
  expect(ui.findButton(enUS.aiAssistant.agentSource.choosePath)?.disabled).toBe(true);
  expect(ui.findButton(enUS.aiAssistant.agentSource.probe)?.disabled).toBe(true);

  // IPC returns false -> reports clearPathFailed and preserves displayed path.
  await act(async () => {
    pendingClear.resolve(false);
    await pendingClear.promise;
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/agy");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.clearPathFailed);
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearPath)?.disabled).toBe(false);

  // IPC rejects -> reports clearPathFailed and preserves displayed path.
  clearMode = "reject";
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.clearPath).click();
  });
  await act(async () => {
    pendingClear.reject(new Error("EACCES"));
    await pendingClear.promise.catch(() => {});
  });
  expect(clearMode).toBe("reject");
  expect(ui.pathInput()?.value).toBe("/custom/bin/agy");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.clearPathFailed);

  // IPC returns true -> clears displayed path, removes alert, hides Clear button.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.clearPath).click();
  });
  await act(async () => {
    pendingClear.resolve(true);
    await pendingClear.promise;
  });
  expect(ui.pathInput()?.value).toBe("");
  expect(ui.alertEl()).toBeNull();
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearPath)).toBeUndefined();
});

test("Antigravity path chooser keeps controls pending, ignores cancellation, and reports errors without changing path", async () => {
  let pendingChoose = deferred();
  const ui = await mountCard({
    initialPath: "/custom/bin/agy",
    chooseAcpAdapterPath: () => {
      pendingChoose = deferred();
      return pendingChoose.promise;
    },
    clearAcpAdapterPath: async () => true,
  });

  // Cancel returns null -> no error, path unchanged.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.choosePath).click();
  });
  expect(ui.findButton(enUS.aiAssistant.agentSource.choosingPath)?.disabled).toBe(true);
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearPath)?.disabled).toBe(true);
  await act(async () => {
    pendingChoose.resolve(null);
    await pendingChoose.promise;
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/agy");
  expect(ui.alertEl()).toBeNull();

  // Rejection reports choosePathFailed and preserves path.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.choosePath).click();
  });
  await act(async () => {
    pendingChoose.reject(new Error("untrusted path"));
    await pendingChoose.promise.catch(() => {});
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/agy");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.choosePathFailed);
});
