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

interface EdgeEverDesktopBridge {
  isAvailable: boolean;
  canClearLocalData: boolean;
  recoveredAfterAbnormalExit: boolean;
  apiBaseUrl: string;
  setApiBaseUrl(value: string): Promise<string>;
  getSessionToken(): string;
  copyText(value: string): Promise<boolean>;
  copyHtml(html: string, plainText: string): Promise<boolean>;
  setSessionToken(value: string): Promise<{ stored: boolean }>;
  clearSessionToken(): Promise<{ stored: false }>;
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
    platform: string;
    architecture: string;
    osVersion: string;
    osRelease: string;
    electron: string;
    chrome: string;
  }>;
  setAccountScope(accountId: string | null): Promise<{ ready: true; scope: string }>;
  updateStatus(): Promise<DesktopUpdateStatus>;
  checkUpdate(): Promise<DesktopUpdateStatus>;
  downloadUpdate(): Promise<unknown>;
  installUpdate(): Promise<unknown>;
  onUpdateStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
  sidecarRequest<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  stageResource(input: { memoId: string; name: string; type: string; bytes: ArrayBuffer }): Promise<{ id: string }>;
  listStagedResources(): Promise<Array<{ id: string; memoId: string; name: string; type: string; size: number }>>;
  remapStagedResourceMemoIds?(mappings: Array<[string, string]>): Promise<{ updated: number }>;
  readStagedResource(id: string): Promise<{ name: string; type: string; bytes: Uint8Array }>;
  readResource(id: string): Promise<{ type: string; bytes: Uint8Array }>;
  removeStagedResource(id: string): Promise<void>;
  onCommand(callback: (command: string) => void): () => void;
  onImportMarkdown(callback: (payload: { name: string; content: string }) => void): () => void;
}

interface DesktopUpdateStatus {
  state: "idle" | "available" | "downloaded";
  version: string | null;
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
