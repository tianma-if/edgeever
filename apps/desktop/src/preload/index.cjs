const { contextBridge, ipcRenderer } = require("electron");

const normalizeIpcBytes = (value) => {
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === "object" && value.type === "Buffer") {
    return normalizeIpcBytes(value.data);
  }
  return new Uint8Array();
};

let screenshotImportListener = null;
let rendererReadySent = false;

contextBridge.exposeInMainWorld("edgeeverDesktop", Object.freeze({
  isAvailable: true,
  canClearLocalData: ipcRenderer.sendSync("desktop:local-data-reset-available-sync"),
  recoveredAfterAbnormalExit: ipcRenderer.sendSync("desktop:recovered-after-abnormal-exit-sync"),
  backup: (action, input) => ipcRenderer.invoke("desktop:backup", action, input).then((result) => {
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  }),
  onBackupStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:backup-status", listener);
    return () => ipcRenderer.removeListener("desktop:backup-status", listener);
  },
  sidecarStatus: () => ipcRenderer.invoke("desktop:sidecar-status"),
  systemInfo: () => ipcRenderer.invoke("desktop:system-info"),
  globalShortcut: () => ipcRenderer.invoke("desktop:global-shortcut"),
  setGlobalShortcut: (binding) => ipcRenderer.invoke("desktop:set-global-shortcut", binding),
  setScreenshotShortcut: (binding) => ipcRenderer.invoke("desktop:set-screenshot-shortcut", binding),
  loginItem: () => ipcRenderer.invoke("desktop:login-item"),
  setLoginItem: (patch) => ipcRenderer.invoke("desktop:set-login-item", patch),
  captureGlobalShortcut: (capturing) => ipcRenderer.invoke("desktop:capture-global-shortcut", capturing),
  setAccountScope: (accountId) => ipcRenderer.invoke("desktop:set-account-scope", accountId),
  apiBaseUrl: ipcRenderer.sendSync("desktop:api-base-url-sync"),
  setApiBaseUrl: (value) => ipcRenderer.invoke("desktop:set-api-base-url", value),
  getSessionToken: () => ipcRenderer.sendSync("desktop:session-token-sync"),
  copyText: (value) => ipcRenderer.invoke("desktop:copy-text", value),
  copyHtml: (html, plainText) => ipcRenderer.invoke("desktop:copy-html", { html, plainText }),
  copyImage: (bytes) => ipcRenderer.invoke("desktop:copy-image", bytes),
  copyFile: (bytes, filename) => ipcRenderer.invoke("desktop:copy-file", bytes, filename),
  readClipboard: () => {
    // Check in the isolated preload world; renderer JavaScript cannot forge this
    // gesture state. Clipboard reads are reserved for an explicit paste action.
    if (!navigator.userActivation?.isActive) return Promise.reject(new Error("Clipboard read requires user activation"));
    return ipcRenderer.invoke("desktop:read-clipboard").then((snapshot) => ({
      html: snapshot.html,
      text: snapshot.text,
      images: snapshot.images.map(normalizeIpcBytes),
    }));
  },
  setSessionToken: (value) => ipcRenderer.invoke("desktop:set-session-token", value),
  clearSessionToken: () => ipcRenderer.invoke("desktop:clear-session-token"),
  testPicGoConnection: (input) => ipcRenderer.invoke("desktop:picgo-test", input),
  uploadPicGoImage: (input) => ipcRenderer.invoke("desktop:picgo-upload", input),
  testImgBedConnection: (input) => ipcRenderer.invoke("desktop:imgbed-test", input),
  uploadImgBedImage: (input) => ipcRenderer.invoke("desktop:imgbed-upload", input),
  publicNetworkFetch: (requestId, input) => ipcRenderer.invoke("desktop:public-network-fetch", requestId, input),
  cancelPublicNetworkFetch: async (requestId) => { ipcRenderer.send("desktop:cancel-public-network-fetch", requestId); },
  openAiProviderStream: (requestId, input) => ipcRenderer.invoke("desktop:ai-direct-open", requestId, input),
  cancelAiProviderStream: (requestId) => { ipcRenderer.send("desktop:ai-direct-cancel", requestId); },
  onAiProviderStreamChunk: (callback) => {
    const listener = (_event, requestId, chunk) => callback(requestId, chunk);
    ipcRenderer.on("desktop:ai-direct-chunk", listener);
    return () => ipcRenderer.removeListener("desktop:ai-direct-chunk", listener);
  },
  listAcpAdapters: () => ipcRenderer.invoke("desktop:acp-list"),
  chooseAcpAdapterPath: () => ipcRenderer.invoke("desktop:acp-choose-path", "antigravity"),
  probeAcpAdapter: (input) => ipcRenderer.invoke("desktop:acp-probe", input),
  installAcpAdapter: (id) => ipcRenderer.invoke("desktop:acp-install", id),
  authenticateAcpAdapter: (input) => ipcRenderer.invoke("desktop:acp-authenticate", input),
  prepareAcp: (input) => ipcRenderer.invoke("desktop:acp-prepare", input),
  promptAcp: (input) => ipcRenderer.invoke("desktop:acp-prompt", input),
  cancelAcp: (requestId) => ipcRenderer.invoke("desktop:acp-cancel", requestId),
  onAcpEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:acp-event", listener);
    return () => ipcRenderer.removeListener("desktop:acp-event", listener);
  },
  clearLocalData: () => ipcRenderer.invoke("desktop:clear-local-data"),
  recordRendererError: (details) => ipcRenderer.invoke("desktop:record-renderer-error", details),
  openRendererIssue: (details) => ipcRenderer.invoke("desktop:open-renderer-issue", details),
  rendererBootstrapReady: () => ipcRenderer.send("desktop:renderer-bootstrap-ready"),
  updateStatus: () => ipcRenderer.invoke("desktop:update-status"),
  checkUpdate: () => ipcRenderer.invoke("desktop:check-update"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("desktop:update-status-changed", listener);
    return () => ipcRenderer.removeListener("desktop:update-status-changed", listener);
  },
  sidecarRequest: (method, params = {}) => ipcRenderer.invoke("desktop:sidecar-request", method, params),
  beginStagedResource: (input) => ipcRenderer.invoke("desktop:stage-resource-begin", input),
  appendStagedResource: (id, bytes) => ipcRenderer.invoke("desktop:stage-resource-append", id, bytes),
  completeStagedResource: (id) => ipcRenderer.invoke("desktop:stage-resource-complete", id),
  abortStagedResource: (id) => ipcRenderer.invoke("desktop:stage-resource-abort", id),
  listStagedResources: () => ipcRenderer.invoke("desktop:list-staged-resources"),
  listStagedResourceAliases: (memoId) => ipcRenderer.invoke("desktop:list-staged-resource-aliases", memoId),
  recordStagedResourceAlias: (id, uploadedUrl) => ipcRenderer.invoke("desktop:record-staged-resource-alias", id, uploadedUrl),
  remapStagedResourceMemoIds: (mappings) => ipcRenderer.invoke("desktop:remap-staged-resource-memo-ids", mappings),
  readStagedResource: (id) => ipcRenderer.invoke("desktop:read-staged-resource", id),
  readStagedResourcePart: (id, start, length) => ipcRenderer.invoke("desktop:read-staged-resource-part", id, start, length),
  readResource: (id) => ipcRenderer.invoke("desktop:read-resource", id),
  removeStagedResource: (id) => ipcRenderer.invoke("desktop:remove-staged-resource", id),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("desktop:command", listener);
    return () => ipcRenderer.removeListener("desktop:command", listener);
  },
  noteWindows: () => ipcRenderer.invoke("desktop:note-windows"),
  openNoteWindow: (memoId) => ipcRenderer.invoke("desktop:open-note-window", memoId),
  focusNoteWindow: (memoId) => ipcRenderer.invoke("desktop:focus-note-window", memoId),
  onNoteWindowsChanged: (callback) => {
    const listener = (_event, memoIds) => callback(Array.isArray(memoIds) ? memoIds : []);
    ipcRenderer.on("desktop:note-windows-changed", listener);
    return () => ipcRenderer.removeListener("desktop:note-windows-changed", listener);
  },
  onNoteWindowCloseRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("desktop:note-window-close-request", listener);
    ipcRenderer.send("desktop:note-window-listening");
    return () => ipcRenderer.removeListener("desktop:note-window-close-request", listener);
  },
  resolveNoteWindowClose: (allowed) => ipcRenderer.send("desktop:note-window-close-result", allowed === true),
  notifyNoteWindowSaved: () => ipcRenderer.send("desktop:note-window-saved"),
  notifyNoteWindowReady: () => ipcRenderer.send("desktop:note-window-ready"),
  notifyNoteWindowLoadFailed: () => ipcRenderer.send("desktop:note-window-load-failed"),
  sendNoteWindowSync: (memoId, update) => ipcRenderer.send("desktop:note-window-sync", memoId, update),
  onNoteWindowSync: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("desktop:note-window-sync", listener);
    return () => ipcRenderer.removeListener("desktop:note-window-sync", listener);
  },
  openMemoInMainWindow: (memoId) => ipcRenderer.invoke("desktop:open-memo-in-main-window", memoId),
  setRichTextHeadingShortcutActive: (active) => {
    ipcRenderer.sendSync("desktop:rich-text-heading-shortcut", active === true);
  },
  onHeadingShortcut: (callback) => {
    const listener = (_event, level) => callback(level);
    ipcRenderer.on("desktop:heading-shortcut", listener);
    return () => ipcRenderer.removeListener("desktop:heading-shortcut", listener);
  },
  onHibernatePrepare: (callback) => {
    const listener = async () => {
      try {
        await callback();
      } finally {
        ipcRenderer.send("desktop:hibernate-prepared");
      }
    };
    ipcRenderer.on("desktop:hibernate-prepare", listener);
    return () => ipcRenderer.removeListener("desktop:hibernate-prepare", listener);
  },
  syncScheduledTasks: (tasks) => ipcRenderer.invoke("desktop:sync-scheduled-tasks", tasks),
  onScheduledTask: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:scheduled-task", listener);
    return () => ipcRenderer.removeListener("desktop:scheduled-task", listener);
  },
  onImportMarkdown: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:import-markdown", listener);
    if (!rendererReadySent) {
      rendererReadySent = true;
      ipcRenderer.send("desktop:renderer-ready");
    }
    return () => ipcRenderer.removeListener("desktop:import-markdown", listener);
  },
  readWeChatImportMedia: (importId, mediaId) => ipcRenderer.invoke("desktop:read-wechat-import-media", importId, mediaId).then((file) => ({
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: normalizeIpcBytes(file.bytes),
  })),
  finishWeChatImport: (importId, success) => ipcRenderer.invoke("desktop:finish-wechat-import", importId, success),
  retryWeChatImport: (importId) => ipcRenderer.invoke("desktop:retry-wechat-import", importId),
  onImportWeChatChat: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:import-wechat-chat", listener);
    return () => ipcRenderer.removeListener("desktop:import-wechat-chat", listener);
  },
  onImportScreenshot: (callback) => {
    if (screenshotImportListener) {
      ipcRenderer.removeListener("desktop:import-screenshot", screenshotImportListener);
    }
    const listener = (_event, payload) => {
      callback({ ...payload, bytes: normalizeIpcBytes(payload?.bytes) });
    };
    screenshotImportListener = listener;
    ipcRenderer.removeAllListeners("desktop:import-screenshot");
    ipcRenderer.on("desktop:import-screenshot", listener);
    return () => {
      ipcRenderer.removeListener("desktop:import-screenshot", listener);
      if (screenshotImportListener === listener) screenshotImportListener = null;
    };
  },
}));
