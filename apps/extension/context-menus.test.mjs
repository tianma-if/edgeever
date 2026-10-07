import { expect, test } from "bun:test";
import { VIDEO_DOCUMENT_PATTERNS } from "./src/video/patterns.ts";

test("registers context menus on install, not on background startup", async () => {
  const installedListeners = [];
  const created = [];
  let removeCount = 0;
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    i18n: { getMessage: (key) => key },
    runtime: {
      onInstalled: { addListener: (listener) => installedListeners.push(listener) },
      onMessage: { addListener: () => {} },
      lastError: undefined,
    },
    contextMenus: {
      onClicked: { addListener: () => {} },
      removeAll: (callback) => {
        removeCount += 1;
        callback();
      },
      create: (options, callback) => {
        created.push(options);
        callback();
      },
    },
    windows: { onRemoved: { addListener: () => {} } },
  };

  try {
    await import("./src/background.ts");
    expect(installedListeners).toHaveLength(1);
    expect(removeCount).toBe(0);
    expect(created).toHaveLength(0);

    installedListeners[0]({ reason: "update" });
    expect(removeCount).toBe(1);
    expect(created.map((item) => item.id)).toEqual([
      "save-selection",
      "save-image",
      "save-tweet",
      "save-github-repo",
      "save-xhs",
      "save-zhihu",
      "save-reddit",
      "save-reddit-link",
      "save-video",
    ]);
    expect(created.find((item) => item.id === "save-xhs")).toMatchObject({
      contexts: ["page", "video"],
      documentUrlPatterns: ["https://www.xiaohongshu.com/*", "https://xiaohongshu.com/*"],
    });
    expect(created.find((item) => item.id === "save-zhihu")).toMatchObject({
      contexts: ["page", "video"],
      documentUrlPatterns: [
        "https://www.zhihu.com/*",
        "https://zhihu.com/*",
        "https://zhuanlan.zhihu.com/*",
        "https://www.zhuanlan.zhihu.com/*",
      ],
    });
    expect(created.find((item) => item.id === "save-reddit")).toMatchObject({
      contexts: ["page", "video"],
      documentUrlPatterns: [
        "https://reddit.com/*",
        "https://www.reddit.com/*",
        "https://old.reddit.com/*",
        "https://new.reddit.com/*",
        "https://sh.reddit.com/*",
      ],
    });
    expect(created.find((item) => item.id === "save-reddit-link")).toMatchObject({
      contexts: ["link"],
      targetUrlPatterns: [
        "https://reddit.com/*/comments/*",
        "https://www.reddit.com/*/comments/*",
        "https://old.reddit.com/*/comments/*",
        "https://new.reddit.com/*/comments/*",
        "https://sh.reddit.com/*/comments/*",
      ],
    });
    expect(created.find((item) => item.id === "save-selection")?.contexts).toEqual(["selection"]);
    expect(created.find((item) => item.id === "save-image")?.contexts).toEqual(["image"]);
    const video = created.find((item) => item.id === "save-video");
    expect(video).toMatchObject({
      contexts: ["page", "video"],
      documentUrlPatterns: VIDEO_DOCUMENT_PATTERNS,
    });
    const hostOf = (pattern) => /^[a-z]+:\/\/([^/*]+)/i.exec(pattern)?.[1] ?? "*";
    const videoHosts = new Set(VIDEO_DOCUMENT_PATTERNS.map(hostOf));
    for (const item of created) {
      if (item.id === "save-video") continue;
      if (!(item.contexts ?? []).some((context) => context === "page" || context === "video")) continue;
      for (const pattern of item.documentUrlPatterns ?? []) {
        expect(videoHosts.has(hostOf(pattern))).toBe(false);
      }
    }
  } finally {
    globalThis.chrome = previousChrome;
  }
});
