/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __EDGEEVER_BUILD_ID__: string;
declare const __EDGEEVER_BUILD_LABEL__: string;
declare const __EDGEEVER_APP_VERSION__: string;
declare const __EDGEEVER_RELEASED_AT__: string;
declare const __EDGEEVER_RELEASE_SUMMARY__: {
  version: string;
  changes: Record<string, string[]>;
};
declare const __EDGEEVER_DEPLOYMENT_TRIGGER__: string;
declare const __EDGEEVER_DEPLOYMENT_METHOD__: string;
declare const __EDGEEVER_DEVELOPMENT_PROFILE__: "" | "local" | "demo";
declare const __EDGEEVER_DESKTOP_BUILD__: boolean;

interface DesktopGlobalShortcutBinding {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

interface DesktopGlobalShortcutState {
  binding: DesktopGlobalShortcutBinding | null;
  registered: boolean;
  screenshot: DesktopGlobalShortcutBinding | null;
  screenshotRegistered: boolean;
  error?: "invalid" | "unavailable" | "saveFailed";
}

interface DesktopLoginItemState {
  supported: boolean;
  openAtLogin: boolean;
  launchMode: "window" | "tray";
  status: "disabled" | "enabled" | "requires-approval" | "disabled-by-system" | "unavailable";
  error?: "invalid" | "saveFailed";
}

/** A main-window sync result for the note shown in a note window. */
interface DesktopNoteWindowSyncUpdate {
  failed: number;
  conflicted: number;
  /** The note as acknowledged by this sync, when it was part of it. */
  memo: import("@edgeever/shared").MemoDetail | null;
}

interface EdgeEverDesktopBridge {
  backup<A extends keyof import("@edgeever/shared").DesktopBackupActions>(action: A, input?: import("@edgeever/shared").DesktopBackupActions[A]["input"]): Promise<import("@edgeever/shared").DesktopBackupActions[A]["output"]>;
  onBackupStatus(callback: (status: import("@edgeever/shared").DesktopBackupStatus | null) => void): () => void;
  isAvailable: boolean;
  canClearLocalData: boolean;
  recoveredAfterAbnormalExit: boolean;
  apiBaseUrl: string;
  setApiBaseUrl(value: string): Promise<string>;
  getSessionToken(): string;
  copyText(value: string): Promise<boolean>;
  copyHtml(html: string, plainText: string): Promise<boolean>;
  copyImage(bytes: Uint8Array): Promise<boolean>;
  copyFile(bytes: Uint8Array, filename: string): Promise<boolean>;
  readClipboard?(): Promise<{ html: string; text: string; images: Uint8Array[] }>;
  setSessionToken(value: string): Promise<{ stored: boolean }>;
  clearSessionToken(): Promise<{ stored: false }>;
  testPicGoConnection(input: { endpoint: string; serverKey?: string }): Promise<boolean>;
  uploadPicGoImage(input: {
    endpoint: string; serverKey?: string; bytes: Uint8Array; filename: string; mimeType: string;
    copy: import("@/lib/picgo").PicGoFailureCopy;
  }): Promise<{ url: string } | { fallback: true }>;
  testImgBedConnection?(input: { endpoint: string; token: string; uploadFolder: string; nameType: import("@/lib/imgbed").ImgBedNameType;
    uploadChannel: import("@/lib/imgbed").ImgBedUploadChannel; serverCompress: boolean }): Promise<boolean>;
  uploadImgBedImage?(input: {
    endpoint: string; token: string; uploadFolder: string; nameType: import("@/lib/imgbed").ImgBedNameType;
    uploadChannel: import("@/lib/imgbed").ImgBedUploadChannel; serverCompress: boolean;
    bytes: Uint8Array; filename: string; mimeType: string; copy: import("@/lib/picgo").PicGoFailureCopy;
  }): Promise<{ url: string } | { fallback: true }>;
  publicNetworkFetch(requestId: string, input: import("@edgeever/shared").PluginPublicFetchRequest): Promise<import("@edgeever/shared").PluginPublicFetchResponse>;
  cancelPublicNetworkFetch(requestId: string): Promise<void>;
  openAiProviderStream(requestId: string, input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body: string;
    bodyBytes?: Uint8Array;
  }): Promise<{ status: number; headers: Record<string, string> }>;
  cancelAiProviderStream(requestId: string): void;
  onAiProviderStreamChunk(callback: (requestId: string, chunk: {
    type: "data" | "end" | "error";
    bytes?: ArrayBuffer | Uint8Array;
    message?: string;
  }) => void): () => void;
  clearLocalData(): Promise<
    { scheduled: true }
    | { scheduled: false; errorCode: DesktopLocalDataResetErrorCode }
  >;
  recordRendererError(details: DesktopRendererErrorDetails): Promise<{ recorded: true }>;
  openRendererIssue(details: DesktopRendererErrorDetails): Promise<{ opened: true }>;
  rendererBootstrapReady(): void;
  sidecarStatus(): Promise<{ available: boolean; path: string; scope: string }>;
  systemInfo(): Promise<{
    appVersion: string;
    autoUpdateSupported: boolean;
    platform: string;
    architecture: string;
    deviceModel: string;
    osVersion: string;
    osRelease: string;
    electron: string;
    chrome: string;
    dataDir: string;
  }>;
  globalShortcut(): Promise<DesktopGlobalShortcutState>;
  setGlobalShortcut(binding: DesktopGlobalShortcutBinding | null): Promise<DesktopGlobalShortcutState>;
  setScreenshotShortcut(binding: DesktopGlobalShortcutBinding | null): Promise<DesktopGlobalShortcutState>;
  loginItem(): Promise<DesktopLoginItemState | null>;
  setLoginItem(patch: { openAtLogin?: boolean; launchMode?: "window" | "tray" }): Promise<DesktopLoginItemState | null>;
  captureGlobalShortcut(capturing: boolean): Promise<boolean>;
  setAccountScope(accountId: string | null): Promise<{ ready: true; scope: string }>;
  updateStatus(): Promise<DesktopUpdateStatus>;
  checkUpdate(): Promise<DesktopUpdateStatus>;
  downloadUpdate(): Promise<unknown>;
  installUpdate(): Promise<unknown>;
  onUpdateStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
  sidecarRequest<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  beginStagedResource(input: { memoId: string; name: string; type: string; size: number }): Promise<{ id: string; partSize: number }>;
  appendStagedResource(id: string, bytes: ArrayBuffer): Promise<{ receivedBytes: number }>;
  completeStagedResource(id: string): Promise<{ id: string }>;
  abortStagedResource(id: string): Promise<void>;
  listStagedResources(): Promise<Array<{ id: string; memoId: string; name: string; type: string; size: number }>>;
  listStagedResourceAliases?(memoId?: string): Promise<Array<{ id: string; memoId: string; resourceId: string }>>;
  recordStagedResourceAlias?(id: string, uploadedUrl: string): Promise<{ id: string; resourceId: string }>;
  remapStagedResourceMemoIds?(mappings: Array<[string, string]>): Promise<{ updated: number }>;
  readStagedResource(id: string): Promise<{ name: string; type: string; bytes: Uint8Array }>;
  readStagedResourcePart(id: string, start: number, length: number): Promise<ArrayBuffer>;
  readResource(id: string): Promise<{ type: string; bytes: Uint8Array }>;
  removeStagedResource(id: string): Promise<void>;
  onCommand(callback: (command: string) => void): () => void;
  noteWindows?(): Promise<string[]>;
  openNoteWindow?(memoId: string): Promise<{ opened: boolean }>;
  focusNoteWindow?(memoId: string): Promise<boolean>;
  onNoteWindowsChanged?(callback: (memoIds: string[]) => void): () => void;
  onNoteWindowCloseRequest?(callback: () => void): () => void;
  resolveNoteWindowClose?(allowed: boolean): void;
  notifyNoteWindowSaved?(): void;
  notifyNoteWindowReady?(): void;
  notifyNoteWindowLoadFailed?(): void;
  sendNoteWindowSync?(memoId: string, update: DesktopNoteWindowSyncUpdate): void;
  onNoteWindowSync?(callback: (update: DesktopNoteWindowSyncUpdate) => void): () => void;
  openMemoInMainWindow?(memoId: string): Promise<boolean>;
  setRichTextHeadingShortcutActive?(active: boolean): void;
  onHeadingShortcut?(callback: (level: number) => void): () => void;
  onHibernatePrepare?(callback: () => void | Promise<void>): () => void;
  syncScheduledTasks(tasks: import("@edgeever/shared").ScheduledTask[]): Promise<{ scheduled: number }>;
  onScheduledTask(callback: (payload: {
    task: import("@edgeever/shared").ScheduledTask;
    scheduledFor: string;
  }) => void | Promise<void>): () => void;
  onImportMarkdown(callback: (payload: { name: string; content: string }) => void): () => void;
  onImportScreenshot?(callback: (payload: { captureId?: string; name: string; type: string; title?: string; bytes: Uint8Array }) => void): () => void;
  readWeChatImportMedia?(importId: string, mediaId: string): Promise<{ filename: string; mimeType: string; bytes: Uint8Array }>;
  finishWeChatImport?(importId: string, success: boolean): Promise<void>;
  retryWeChatImport?(importId: string): Promise<boolean>;
  listAcpAdapters?(): Promise<Array<{
    id: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    label: string;
    state: "not_installed" | "not_probed" | "installing" | "needs_login" | "available" | "failed";
    detail?: string;
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    version?: string;
    managed?: boolean;
    updateError?: string;
    authMethods?: Array<{ id: string; name: string }>;
  }>>;
  chooseAcpAdapterPath?(): Promise<string | null>;
  probeAcpAdapter?(input: { id: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl"; path?: string }): Promise<{
    id: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    label: string;
    state: "not_installed" | "needs_login" | "available" | "failed";
    detail?: string;
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    version?: string;
    managed?: boolean;
    authMethods?: Array<{ id: string; name: string }>;
  }>;
  installAcpAdapter?(id: "codex" | "claudeCode" | "antigravity" | "piAgent"): Promise<{ updated: boolean; version?: string; adapter?: {
    id: "codex" | "claudeCode" | "antigravity" | "piAgent";
    label: string;
    state: "not_installed" | "needs_login" | "available" | "failed";
    detail?: string;
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    authMethods?: Array<{ id: string; name: string }>;
  } }>;
  authenticateAcpAdapter?(input: { id: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl"; path?: string; methodId: string }): Promise<{
    id: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    label: string;
    state: "not_installed" | "needs_login" | "available" | "failed";
    detail?: string;
    authMethods?: Array<{ id: string; name: string }>;
  }>;
  prepareAcp?(input: {
    adapterId: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    path?: string;
    sessionKey?: string;
    noteAccess?: boolean;
  }): Promise<{ ready: boolean }>;
  promptAcp?(input: {
    adapterId: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    path?: string;
    prompt: string;
    contextText?: string;
    historyText?: string;
    sessionKey?: string;
    attachments?: Array<{ filename: string; mediaType: string; dataBase64: string }>;
    noteAccess?: boolean;
  }): Promise<{ requestId: string; rejectedAttachments?: Array<{ filename: string; reason: string }> }>;
  cancelAcp?(requestId: string): Promise<{ ok: true }>;
  onAcpEvent?(callback: (event:
    | { requestId: string; type: "text-delta"; text: string; messageId?: string }
    | { requestId: string; type: "reasoning"; text: string }
    | { requestId: string; type: "tool"; name: string; status: string; title?: string }
    | { requestId: string; type: "image"; id: string; mediaType: string; base64: string }
    | { requestId: string; type: "done" }
    | { requestId: string; type: "error"; message: string }
  ) => void): () => void;
  onImportWeChatChat?(callback: (payload: {
    ok: boolean;
    kind?: "file";
    reason?: string;
    importId?: string;
    title?: string;
    filename?: string;
    mimeType?: string;
    byteSize?: number;
    markdown?: string;
    media?: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
  }) => void): () => void;
}

interface DesktopUpdateNetworkDiagnostic {
  checkId: number;
  startedAt: number | null;
  elapsedMs: number;
  observedSessions: string[];
  proxyScope: string;
  omittedRequests: number;
  requests: Array<{
    checkId: number;
    requestId: string;
    session: string;
    stage: string;
    url: string | null;
    startedAt: number;
    elapsedMs: number;
    status: "pending" | "completed" | "failed" | "redirected";
    httpStatus: number | null;
    errorCode: string | null;
    redirectUrl?: string | null;
    proxy: { state: "pending" | "resolved" | "failed" | "timeout"; value: string | null; errorCode?: string };
  }>;
}

interface DesktopUpdateDiagnostic {
  at: string;
  stage: string;
  version: string;
  platform: string;
  arch: string;
  code: string | null;
  message: string;
  source: string;
  network?: DesktopUpdateNetworkDiagnostic;
}

interface DesktopUpdateDownloadProgress {
  percent: number | null;
  transferred: number | null;
  total: number | null;
  bytesPerSecond: number | null;
}

interface DesktopUpdateStatus {
  state: "idle" | "available" | "downloaded";
  version: string | null;
  error?: DesktopUpdateDiagnostic | null;
  progress?: DesktopUpdateDownloadProgress | null;
}

type DesktopLocalDataResetErrorCode =
  | "unsafe-data-directory"
  | "application-bundle-not-found"
  | "helper-start-failed"
  | "unexpected";

interface DesktopRendererErrorDetails {
  kind: string;
  message?: string;
  stack?: string;
  componentStack?: string;
  reason?: string;
  exitCode?: number;
}

interface EdgeEverPrintBridge {
  savePdf: () => Promise<Uint8Array>;
}

interface Window {
  edgeeverDesktop?: EdgeEverDesktopBridge;
  edgeeverPrint?: EdgeEverPrintBridge;
}
