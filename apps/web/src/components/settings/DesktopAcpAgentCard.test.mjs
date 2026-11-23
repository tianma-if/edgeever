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

const mountCard = async ({
  initialPath = "/custom/bin/antigravity-acp",
  initialMode = "standalone",
  initialState = "not_probed",
  listAcpAdapters,
  setAcpAdapterMode,
  chooseAcpAdapterPath,
  clearAcpAdapterPath,
  installAcpAdapter,
} = {}) => {
  const { window } = parseHTML("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
  const storage = createMemoryStorage({
    [AI_SIDEBAR_SOURCE_KEY]: "local",
    [AI_SIDEBAR_ADAPTER_KEY]: "antigravity",
    [AI_SIDEBAR_ADAPTER_PATH_KEY]: initialPath,
  });
  let currentMode = initialMode;
  let currentState = initialState;
  const paths = {
    standalone: initialMode === "standalone" ? initialPath : "",
    cli: initialMode === "cli" ? initialPath : "",
  };
  let pollCallback = null;
  window.localStorage = storage;
  window.setInterval = (cb) => { pollCallback = cb; return 1; };
  window.clearInterval = () => { pollCallback = null; };
  const defaultList = async () => [{
    id: "antigravity",
    label: "Antigravity",
    state: currentState,
    ...(currentState === "not_probed" ? { detail: "not_probed" } : {}),
    antigravityMode: currentMode,
    ...(paths[currentMode] ? { customPath: paths[currentMode] } : {}),
  }];
  window.edgeeverDesktop = {
    isAvailable: true,
    listAcpAdapters: listAcpAdapters ? () => listAcpAdapters({ currentMode, paths, defaultList }) : defaultList,
    setAcpAdapterMode: async (nextMode) => {
      const ok = setAcpAdapterMode ? await setAcpAdapterMode(nextMode) : true;
      if (ok) currentMode = nextMode;
      return ok;
    },
    chooseAcpAdapterPath: async () => {
      const result = await chooseAcpAdapterPath();
      if (result) paths[currentMode] = result;
      return result;
    },
    clearAcpAdapterPath: async () => {
      const result = await clearAcpAdapterPath();
      if (result) {
        paths.standalone = "";
        paths.cli = "";
      }
      return result;
    },
    installAcpAdapter: async (id) => {
      const result = installAcpAdapter ? await installAcpAdapter(id) : { updated: true, version: "1.5.2" };
      if (id === "antigravity" && (result.updated || result.version)) {
        paths.standalone = "";
        currentState = "available";
      }
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
  const modeRadio = (mode) => container.querySelector(`input[type="radio"][value="${mode}"]`);
  const pathInput = () => container.querySelector(`input[aria-label="${enUS.aiAssistant.agentSource.pathLabel}"]`);
  const alertEl = () => container.querySelector('[role="alert"]');
  const triggerPoll = () => pollCallback?.();
  return { container, findButton, modeRadio, pathInput, alertEl, triggerPoll };
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

test("Antigravity path clear keeps controls pending, reports false or rejected clears, and ignores stale polls", async () => {
  let pendingClear = deferred();
  let stalePoll = null;
  let interceptNextPoll = false;
  const ui = await mountCard({
    initialPath: "/custom/bin/antigravity-acp",
    listAcpAdapters: ({ defaultList }) => {
      if (interceptNextPoll) {
        interceptNextPoll = false;
        stalePoll = deferred();
        return stalePoll.promise;
      }
      return defaultList();
    },
    chooseAcpAdapterPath: async () => null,
    clearAcpAdapterPath: () => {
      pendingClear = deferred();
      return pendingClear.promise;
    },
  });

  expect(ui.pathInput()?.value).toBe("/custom/bin/antigravity-acp");
  expect(ui.alertEl()).toBeNull();

  // Click Clear -> stays pending and disables Choose/Clear/Probe.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.clearPath).click();
  });
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearingPath)?.disabled).toBe(true);
  expect(ui.findButton(enUS.aiAssistant.agentSource.choosePath)?.disabled).toBe(true);
  expect(ui.findButton(enUS.aiAssistant.agentSource.probe)?.disabled).toBe(true);

  // IPC returns false -> reports clearPathFailed and preserves displayed path.
  await act(async () => {
    pendingClear.resolve(false);
    await pendingClear.promise;
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/antigravity-acp");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.clearPathFailed);
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearPath)?.disabled).toBe(false);

  // IPC rejects -> reports clearPathFailed and preserves displayed path.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.clearPath).click();
  });
  await act(async () => {
    pendingClear.reject(new Error("EACCES"));
    await pendingClear.promise.catch(() => {});
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/antigravity-acp");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.clearPathFailed);

  // Start a 5s poll BEFORE clicking Clear, then complete Clear, then resolve the stale poll -> path must stay cleared!
  interceptNextPoll = true;
  await act(async () => {
    ui.triggerPoll();
  });
  expect(stalePoll).toBeTruthy();

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

  await act(async () => {
    stalePoll.resolve([{
      id: "antigravity",
      label: "Antigravity",
      state: "not_probed",
      detail: "not_probed",
      antigravityMode: "standalone",
      customPath: "/custom/bin/antigravity-acp",
    }]);
    await stalePoll.promise;
  });
  expect(ui.pathInput()?.value).toBe("");
  expect(ui.findButton(enUS.aiAssistant.agentSource.clearPath)).toBeUndefined();
});

test("Antigravity path chooser supports success, silent cancellation, and error feedback", async () => {
  let pendingChoose = deferred();
  const ui = await mountCard({
    initialPath: "/custom/bin/antigravity-acp",
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
  expect(ui.pathInput()?.value).toBe("/custom/bin/antigravity-acp");
  expect(ui.alertEl()).toBeNull();

  // Rejection reports choosePathFailed and preserves path.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.choosePath).click();
  });
  await act(async () => {
    pendingChoose.reject(new Error("untrusted path"));
    await pendingChoose.promise.catch(() => {});
  });
  expect(ui.pathInput()?.value).toBe("/custom/bin/antigravity-acp");
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.choosePathFailed);

  // Successful selection updates path and clears previous error.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.choosePath).click();
  });
  await act(async () => {
    pendingChoose.resolve("/opt/new/antigravity-acp");
    await pendingChoose.promise;
  });
  expect(ui.pathInput()?.value).toBe("/opt/new/antigravity-acp");
  expect(ui.alertEl()).toBeNull();
});

test("Antigravity mode toggle defaults to standalone, switches to cli with CLI hints, reports failed switches, and clears path on no-op install", async () => {
  let modeResult = false;
  const ui = await mountCard({
    initialPath: "/missing/standalone-acp",
    initialMode: "standalone",
    initialState: "not_installed",
    setAcpAdapterMode: async () => modeResult,
    chooseAcpAdapterPath: async () => null,
    clearAcpAdapterPath: async () => true,
    installAcpAdapter: async () => ({
      updated: false,
      version: "1.5.2",
      adapter: { id: "antigravity", label: "Antigravity", state: "available" },
    }),
  });

  // Defaults to standalone mode and offers Install button when not_installed.
  expect(ui.modeRadio("standalone")?.checked).toBe(true);
  expect(ui.modeRadio("cli")?.checked).toBe(false);
  expect(ui.findButton(enUS.aiAssistant.agentSource.install)).toBeTruthy();

  // Failed mode switch shows alert and keeps standalone selected.
  await act(async () => {
    ui.modeRadio("cli").click();
  });
  expect(ui.modeRadio("standalone")?.checked).toBe(true);
  expect(ui.alertEl()?.textContent).toBe(enUS.aiAssistant.agentSource.antigravityModeChangeFailed);

  // No-op install returning { updated: false, version: "1.5.2" } still clears stale standalone custom path.
  await act(async () => {
    ui.findButton(enUS.aiAssistant.agentSource.install).click();
  });
  expect(ui.pathInput()?.value).toBe("");
  expect(ui.alertEl()).toBeNull();

  // Successful mode switch to CLI updates radio, placeholder, and hides standalone Install button.
  modeResult = true;
  await act(async () => {
    ui.modeRadio("cli").click();
  });
  expect(ui.modeRadio("cli")?.checked).toBe(true);
  expect(ui.pathInput()?.getAttribute("placeholder")).toBe(enUS.aiAssistant.agentSource.antigravityCliPathPlaceholder);
});
