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
  error?: "invalid" | "unavailable" | "saveFailed";
}

interface EdgeEverDesktopBridge {
  isAvailable: boolean;
  canClearLocalData: boolean;
  recoveredAfterAbnormalExit: boolean;
  apiBaseUrl: string;
  setApiBaseUrl(value: string): Promise<string>;
  getSessionToken(): string;
  copyText(value: string): Promise<boolean>;
  copyHtml(html: string, plainText: string): Promise<boolean>;
  copyImage(bytes: Uint8Array): Promise<boolean>;
  setSessionToken(value: string): Promise<{ stored: boolean }>;
  clearSessionToken(): Promise<{ stored: false }>;
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
  promptAcp?(input: {
    adapterId: "codex" | "claudeCode" | "antigravity" | "openClaw" | "hermesAgent" | "grokBuild" | "deepseekHarness" | "piAgent" | "workbuddyCn" | "workbuddyIntl";
    path?: string;
    prompt: string;
    contextText?: string;
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

interface DesktopUpdateDiagnostic {
  at: string;
  stage: string;
  version: string;
  platform: string;
  arch: string;
  code: string | null;
  message: string;
  source: string;
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

interface Window {
  edgeeverDesktop?: EdgeEverDesktopBridge;
}
