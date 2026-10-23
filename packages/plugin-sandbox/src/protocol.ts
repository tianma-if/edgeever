import type {
  ExtensionPlatform,
  PluginCommand,
  PluginEventMap,
  PluginJsonValue,
  PluginManifest,
  PluginPanel,
  PluginPanelChrome,
  PluginSettingValue,
} from "@edgeever/plugin-api";

/**
 * Version of the native-host <-> sandbox message protocol. Both sides must agree
 * before any plugin code runs; bump it when a message shape changes incompatibly.
 */
export const PLUGIN_SANDBOX_PROTOCOL_VERSION = 1 as const;

/** Native platforms that host plugins inside a WebView sandbox. */
export type SandboxPlatform = Extract<ExtensionPlatform, "android" | "ios">;

export const SANDBOX_PLATFORMS: readonly SandboxPlatform[] = ["android", "ios"];

/** Host services a sandbox may call. Keep names namespaced by API area. */
export const SANDBOX_REQUEST_METHODS = [
  "notes.query",
  "notes.queryContent",
  "notes.get",
  "notes.create",
  "notes.update",
  "notes.delete",
  "notes.move",
  "notes.pin",
  "notes.restore",
  "notes.editMarkdown",
  "notes.revisions.list",
  "notes.revisions.restore",
  "notebooks.list",
  "notebooks.create",
  "notebooks.update",
  "notebooks.delete",
  "tags.list",
  "tags.rename",
  "tags.delete",
  "templates.list",
  "templates.create",
  "templates.update",
  "templates.delete",
  "templates.use",
  "resources.list",
  "resources.read",
  "storage.get",
  "storage.set",
  "storage.remove",
  "secrets.get",
  "secrets.set",
  "secrets.remove",
  "settings.get",
  "settings.set",
  "settings.remove",
  "network.fetch",
  "ui.openNote",
  "panel.open",
] as const;

export type SandboxRequestMethod = (typeof SANDBOX_REQUEST_METHODS)[number];

/** Services the sandbox must answer when the native host asks. */
export const SANDBOX_QUERY_METHODS = [
  "panel.beforeClose",
] as const;

export type SandboxQueryMethod = (typeof SANDBOX_QUERY_METHODS)[number];

export interface SandboxErrorPayload {
  message: string;
  /** Mirrors `PluginApiErrorCode` where the host can classify the failure. */
  code?: string;
}

export interface SandboxSerializedPanelChrome {
  header?: PluginPanelChrome["header"];
  toolbar?: PluginPanelChrome["toolbar"];
  empty?: PluginPanelChrome["empty"];
}

export interface SandboxRegisteredCommand {
  id: string;
  title: string;
  listed: boolean;
  menu: boolean;
}

export interface SandboxRegisteredPanel {
  id: string;
  title: string;
  purpose: PluginPanel["purpose"];
  presentation: NonNullable<PluginPanel["presentation"]>;
}

/** Messages sent by the native host into the WebView sandbox. */
export type SandboxInboundMessage =
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "init";
      manifest: PluginManifest;
      platform: SandboxPlatform;
      locale?: string;
      /** Host-owned settings snapshot so plugins can read synchronously during activate. */
      settings?: Record<string, PluginSettingValue>;
    }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "settings.changed"; key: string; value: PluginSettingValue | null }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "event"; event: keyof PluginEventMap; payload: unknown }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "command.run"; commandId: string }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "panel.open";
      panelId: string;
      state?: PluginJsonValue;
      /**
       * Host-created WebView already sized for the panel; the sandbox renders into
       * its own document root.
       */
    }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "panel.action"; panelId: string; actionId: string }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "panel.change"; panelId: string; key: string; value: string }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "panel.close"; panelId: string }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "request";
      id: number;
      method: SandboxQueryMethod;
      params?: unknown;
    }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "response";
      id: number;
      ok: boolean;
      result?: unknown;
      error?: SandboxErrorPayload;
    };

/** Messages sent by the sandbox runtime to the native host. */
export type SandboxOutboundMessage =
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "ready" }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "activated";
      commands: SandboxRegisteredCommand[];
      panels: SandboxRegisteredPanel[];
    }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "request";
      id: number;
      method: SandboxRequestMethod;
      params?: unknown;
    }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "notice"; message: string }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "panel.chrome";
      panelId: string;
      chrome: SandboxSerializedPanelChrome;
    }
  | { v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION; type: "panel.close-request"; panelId: string }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "query-result";
      id: number;
      ok: boolean;
      result?: unknown;
      error?: SandboxErrorPayload;
    }
  | {
      v: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
      type: "error";
      scope: "runtime" | "activate" | "command" | "panel";
      message: string;
      stack?: string;
    };

export type SandboxMessage = SandboxInboundMessage | SandboxOutboundMessage;

/** Serialize plugin panel chrome across the bridge; callbacks stay in the sandbox. */
export const serializePanelChrome = (chrome: PluginPanelChrome | null | undefined): SandboxSerializedPanelChrome => {
  if (!chrome || typeof chrome !== "object") return {};
  const serialized: SandboxSerializedPanelChrome = {};
  if (chrome.header) serialized.header = chrome.header;
  if (chrome.toolbar) serialized.toolbar = chrome.toolbar;
  if (chrome.empty !== undefined) serialized.empty = chrome.empty;
  return serialized;
};

export const isSandboxPlatform = (value: unknown): value is SandboxPlatform =>
  value === "android" || value === "ios";

export const manifestSupportsPlatform = (manifest: PluginManifest, platform: SandboxPlatform): boolean =>
  !manifest.platforms?.length || manifest.platforms.includes(platform);

/** Commands/panels as the host expects them after activation. */
export const toRegisteredCommand = (command: PluginCommand): SandboxRegisteredCommand => ({
  id: command.id,
  title: command.title,
  listed: command.listed !== false,
  menu: command.menu !== false,
});

export const toRegisteredPanel = (panel: PluginPanel): SandboxRegisteredPanel => ({
  id: panel.id,
  title: panel.title,
  purpose: panel.purpose,
  presentation: panel.presentation ?? "dialog",
});
