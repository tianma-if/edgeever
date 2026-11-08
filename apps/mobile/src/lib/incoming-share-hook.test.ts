import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Exercise the distributed entrypoint Metro bundles, rather than only its TypeScript source.
const hookSource = readFileSync(
  new URL("../../node_modules/expo-sharing/build/useIncomingShare.js", import.meta.url), "utf8",
);
const hookCode = new Bun.Transpiler({ loader: "ts" }).transformSync(hookSource)
  .replace(/^import .* from [^;]+;\n/gm, "")
  .replace("export function useIncomingShare", "function useIncomingShare");

const article = [{ value: "https://www.zhihu.com/pin/2094371908041052336", mimeType: "text/plain", shareType: "url" }];
const deferred = () => {
  let resolve!: (value: unknown[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function mountHook(initialPayloads = article) {
  const slots: unknown[] = [];
  let cursor = 0;
  let nativePayloads = initialPayloads;
  const requests: ReturnType<typeof deferred>[] = [];
  const effects: (() => void | (() => void))[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const eventSource = (prefix: string) => ({
    addEventListener: (event: string, callback: (value: unknown) => void) => {
      const key = `${prefix}:${event}`;
      listeners.set(key, callback);
      return { remove: () => { listeners.delete(key); } };
    },
  });
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next: unknown) => { slots[index] = next; }];
  };
  const useRef = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  const hook = new Function(
    "useState", "useRef", "useCallback", "useEffect", "AppState", "Linking",
    "clearNativeSharedPayloads", "getSharedPayloads", "getResolvedSharedPayloadsAsync",
    `${hookCode}\nreturn useIncomingShare;`,
  )(
    useState, useRef, (callback: unknown) => callback,
    (effect: () => void | (() => void)) => { effects.push(effect); },
    eventSource("app"), eventSource("link"),
    () => { nativePayloads = []; }, () => nativePayloads,
    () => { const request = deferred(); requests.push(request); return request.promise; },
  );
  return {
    render: () => { cursor = 0; return hook(); },
    shareAgain: (payloads = article) => { nativePayloads = payloads; },
    mount: () => effects.shift()?.(),
    foreground: () => listeners.get("app:change")?.("active"),
    incomingShare: () => listeners.get("link:url")?.({ url: "edgeever://expo-sharing" }),
    requests,
  };
}

describe("incoming share hook", () => {
  test("reports an empty image resolution instead of leaving the share waiting forever", async () => {
    const images = [{ value: "content://com.zhihu.android/shared-image.jpg", mimeType: "image/jpeg", shareType: "image" }];
    const app = mountHook(images);
    const pending = app.render().refreshSharePayloads();
    app.requests[0]!.resolve([]);
    await pending;
    expect(app.render().isResolving).toBe(false);
    expect(app.render().error?.message).toBe("Shared content could not be resolved");
    expect(app.render().sharedPayloads).toEqual(images);
    expect(app.render().resolvedSharedPayloads).toEqual([]);
  });

  test("keeps a cold-start image share until the workspace is ready to consume it", async () => {
    const images = [{ value: "content://com.zhihu.android/shared-image.jpg", mimeType: "image/jpeg", shareType: "image" }];
    const resolvedImages = [{ ...images[0], contentUri: "file:///cache/shared-image.jpg" }];
    const app = mountHook(images);
    expect(app.render().sharedPayloads).toEqual(images);
    const unmount = app.mount();
    expect(app.render().isResolving).toBe(true);
    app.foreground();
    expect(app.requests).toHaveLength(1);
    app.requests[0]!.resolve(resolvedImages);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Session and persisted notebook restoration can finish after resolution.
    expect(app.render().resolvedSharedPayloads).toEqual(resolvedImages);
    app.foreground();
    expect(app.render().resolvedSharedPayloads).toEqual(resolvedImages);
    expect(app.requests).toHaveLength(1);
    app.render().clearSharedPayloads();
    expect(app.render().resolvedSharedPayloads).toEqual([]);
    if (typeof unmount === "function") unmount();
  });

  test("receives a warm image share after the app is already active and removes listeners", async () => {
    const app = mountHook();
    app.render().clearSharedPayloads();
    const unmount = app.mount();
    app.foreground(); // resume can happen before Android delivers onNewIntent
    const images = [{ value: "content://com.zhihu.android/shared-image.jpg", mimeType: "image/jpeg", shareType: "image" }];
    const resolvedImages = [{ ...images[0], contentUri: "file:///cache/shared-image.jpg" }];
    app.shareAgain(images);
    app.incomingShare();
    expect(app.requests).toHaveLength(1);
    app.incomingShare(); // URL and AppState must not resolve the same intent twice
    expect(app.requests).toHaveLength(1);
    app.requests[0]!.resolve(resolvedImages);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.render().resolvedSharedPayloads).toEqual(resolvedImages);
    if (typeof unmount === "function") unmount();
    app.render().clearSharedPayloads();
    app.shareAgain();
    app.incomingShare();
    app.foreground();
    expect(app.requests).toHaveLength(1);
  });

  test("clearing during resolution prevents a late result replaying a consumed Zhihu share", async () => {
    const app = mountHook();
    const pending = app.render().refreshSharePayloads();
    app.render().clearSharedPayloads();
    app.requests[0]!.resolve(article);
    await pending;
    expect(app.render().sharedPayloads).toEqual([]);
    expect(app.render().resolvedSharedPayloads).toEqual([]);
    expect(app.render().isResolving).toBe(false);
    await app.render().refreshSharePayloads(); // returning to the foreground
    expect(app.requests).toHaveLength(1);
  });

  test("a stale failure cannot overwrite a new share or end its loading state", async () => {
    const app = mountHook();
    const first = app.render().refreshSharePayloads();
    app.render().clearSharedPayloads();
    app.shareAgain();
    const second = app.render().refreshSharePayloads();
    app.requests[0]!.reject(new Error("old request failed"));
    await first;
    expect(app.render().error).toBeNull();
    expect(app.render().isResolving).toBe(true);
    app.requests[1]!.resolve(article);
    await second;
    expect(app.render().resolvedSharedPayloads).toEqual(article);
    expect(app.render().isResolving).toBe(false);
  });

  test("the user can deliberately share the same link after completing a clip", async () => {
    const app = mountHook();
    const first = app.render().refreshSharePayloads();
    app.requests[0]!.resolve(article);
    await first;
    app.render().clearSharedPayloads();
    expect(app.render().resolvedSharedPayloads).toEqual([]);
    await app.render().refreshSharePayloads();
    app.shareAgain();
    const second = app.render().refreshSharePayloads();
    expect(app.requests).toHaveLength(2);
    app.requests[1]!.resolve(article);
    await second;
    expect(app.render().resolvedSharedPayloads).toEqual(article);
  });
});

const workspaceShareEffectBody = () => {
  const source = readFileSync(new URL("../screens/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const marker = "  useEffect(() => {";
  const start = source.indexOf(`${marker}\n    if (incomingShareIsResolving || shareImportKind)`);
  const end = source.indexOf("  }, [", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start + marker.length, end));
};

test("workspace reports a share that could not be copied for lack of storage", () => {
  const alerts: unknown[][] = [];
  let handled = 0;
  const context = {
    incomingShareIsResolving: false,
    shareImportKind: null,
    incomingShareError: { code: "ERR_WECHAT_ARCHIVE_STORAGE" },
    processedShareUrlRef: { current: null },
    getWeChatArchiveErrorCode: (error: { code: string }) => error.code,
    WECHAT_ARCHIVE_STORAGE_HINT: "释放一些空间",
    Alert: { alert: (...args: unknown[]) => alerts.push(args) },
    onIncomingShareHandledRef: { current: () => { handled++; } },
  };
  const run = () => new Function(...Object.keys(context), workspaceShareEffectBody())(...Object.values(context));
  run();
  run();
  expect(alerts).toEqual([["无法导入微信聊天记录", "释放一些空间"]]);
  expect(handled).toBe(1);
});

test("workspace finishes the accepted clip when resolved payloads rerun its effect", async () => {
  const effectBody = workspaceShareEffectBody();
  const request = deferred();
  const opened: unknown[] = [];
  let importing = false;
  let handled = 0;
  const context = {
    createOpen: false,
    incomingShareIsResolving: false,
    incomingShareError: null,
    incomingSharePayloads: article,
    incomingShareUrl: article[0]!.value,
    sharedImages: [],
    sharedWeChatArchive: null,
    shareImportKind: null as string | null,
    notebooks: [{}],
    notebooksQuery: { isSuccess: true },
    processedShareUrlRef: { current: null },
    incomingShareTaskRef: { current: null },
    resolvedLocale: "zh-CN",
    isWeChatArticleUrl: () => false,
    setShareImportKind: (value: string | null) => {
      context.shareImportKind = value;
      importing = value !== null;
    },
    buildMobileWebClipDraft: () => request.promise,
    openIncomingClipDraft: (draft: unknown) => { opened.push(draft); },
    onIncomingShareHandledRef: { current: () => { handled++; } },
    Alert: { alert: () => { throw new Error("unexpected alert"); } },
  };
  const runEffect = () => new Function(...Object.keys(context), effectBody)(...Object.values(context));
  const cleanup = runEffect();
  expect(importing).toBe(true);
  // React cleans up the previous effect when the hook replaces raw payloads
  // with resolved payloads, even though the article URL has not changed.
  if (typeof cleanup === "function") cleanup();
  runEffect();
  const draft = { title: "知乎", contentMarkdown: "来源链接" };
  request.resolve([draft]);
  await request.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(opened).toEqual([[draft]]);
  expect(importing).toBe(false);
  expect(handled).toBe(1);
});

describe("consecutive shares while the create editor stays open", () => {
  const effectBody = workspaceShareEffectBody();

  test.each(["article", "image", "wechat"])("holds a new %s share until the previous note is saved and unmounted", (kind) => {
    const images = kind === "image" ? [{ uri: "file:///cache/second.jpg" }] : [];
    let finishRequested = false;
    let nextEditorOpened = false;
    let handled = 0;
    const previousImages: unknown[] = [];
    let nextImages: unknown[] = previousImages;
    const context = {
      createOpen: true,
      incomingShareIsResolving: false,
      incomingShareError: null,
      incomingSharePayloads: article,
      incomingShareUrl: article[0]!.value,
      sharedImages: images,
      sharedWeChatArchive: kind === "wechat" ? { uri: "file:///cache/chat.zip" } : null,
      shareImportKind: null,
      notebooks: [{}],
      notebooksQuery: { isSuccess: true },
      processedShareUrlRef: { current: "https://www.zhihu.com/pin/previous" },
      setFinishCreateForIncomingShare: (value: boolean) => { finishRequested = value; },
      beginEditorStartup: () => {},
      setSelectedMemoId: () => {},
      setIncomingClipDraft: () => {},
      setIncomingShareImages: (value: unknown[]) => { nextImages = value; },
      setCreateSeed: () => {},
      setActiveView: () => {},
      setMemoView: () => {},
      setCreateOpen: (value: boolean) => { nextEditorOpened = value; },
      translate: (value: string) => value,
      onIncomingShareHandledRef: { current: () => { handled++; } },
    };
    const run = () => new Function(...Object.keys(context), effectBody)(...Object.values(context));
    run();
    expect(finishRequested).toBe(true);
    expect(nextEditorOpened).toBe(false);
    expect(nextImages).toBe(previousImages);
    expect(handled).toBe(0);
    expect(context.processedShareUrlRef.current).toBe("https://www.zhihu.com/pin/previous");
    if (kind === "image") {
      context.createOpen = false; // Only a successful save closes the old editor.
      run();
      expect(nextEditorOpened).toBe(true);
      expect(nextImages).toEqual(images);
      expect(handled).toBe(1);
    }
  });

  test("waits for editor readiness and the entire image batch, then saves once without retrying failures", () => {
    const editor = readFileSync(new URL("../screens/WorkspaceEditors.tsx", import.meta.url), "utf8");
    const start = editor.indexOf("  useEffect(() => {\n    if (!finishForIncomingShare)");
    const end = editor.indexOf("  }, [finishForIncomingShare,", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = editor.slice(start + "  useEffect(() => {".length, end);
    let saves = 0;
    const context = {
      finishForIncomingShare: true,
      draftLoaded: false,
      editorReady: false,
      importingSharedImages: true,
      sharedImageImportFailed: false,
      imageOperation: "idle",
      submitStarted: false,
      shareHandoffStartedRef: { current: false },
      submitCreateMemo: () => { saves++; },
    };
    const run = () => new Function(...Object.keys(context), body)(...Object.values(context));
    run();
    context.draftLoaded = true;
    context.editorReady = true;
    run(); // idle between two images must not close the editor
    expect(saves).toBe(0);
    context.importingSharedImages = false;
    context.imageOperation = "uploading";
    run();
    expect(saves).toBe(0);
    context.imageOperation = "idle";
    context.sharedImageImportFailed = true;
    run(); // an upload error must leave the previous note open
    expect(saves).toBe(0);
    context.sharedImageImportFailed = false;
    run();
    expect(saves).toBe(1);
    context.submitStarted = true;
    run();
    context.submitStarted = false; // save failed: preserve the old editor for retry
    run();
    expect(saves).toBe(1);
  });
});
