/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __EDGEEVER_BUILD_ID__: string;
declare const __EDGEEVER_BUILD_LABEL__: string;
declare const __EDGEEVER_APP_VERSION__: string;
declare const __EDGEEVER_RELEASED_AT__: string;
declare const __EDGEEVER_DEPLOYMENT_TRIGGER__: string;
declare const __EDGEEVER_DEPLOYMENT_METHOD__: string;

interface EdgeEverDesktopBridge {
  isAvailable: boolean;
  apiBaseUrl: string;
  setApiBaseUrl(value: string): Promise<string>;
  sidecarStatus(): Promise<{ available: boolean; path: string; scope: string }>;
  setAccountScope(accountId: string | null): Promise<{ ready: true; scope: string }>;
  updateStatus(): Promise<{ state: "idle" | "available" | "downloaded" }>;
  downloadUpdate(): Promise<unknown>;
  installUpdate(): Promise<unknown>;
  sidecarRequest<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  stageResource(input: { memoId: string; name: string; type: string; bytes: ArrayBuffer }): Promise<{ id: string }>;
  listStagedResources(): Promise<Array<{ id: string; memoId: string; name: string; type: string; size: number }>>;
  readStagedResource(id: string): Promise<{ name: string; type: string; bytes: Uint8Array }>;
  removeStagedResource(id: string): Promise<void>;
  onCommand(callback: (command: string) => void): () => void;
  onImportMarkdown(callback: (payload: { name: string; content: string }) => void): () => void;
}

interface Window {
  edgeeverDesktop?: EdgeEverDesktopBridge;
}
