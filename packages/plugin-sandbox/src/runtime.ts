import type { EdgeEverPlugin, PluginManifest } from "@edgeever/plugin-api";
import { createSandboxBridge, type SandboxBridge, type SandboxTransport } from "./bridge.ts";
import { createSandboxPluginContext, type SandboxContextHandle } from "./context.ts";
import { createPanelHost, type PanelHost } from "./panel.ts";
import {
  PLUGIN_SANDBOX_PROTOCOL_VERSION,
  isSandboxPlatform,
  manifestSupportsPlatform,
  type SandboxInboundMessage,
  type SandboxPlatform,
  type SandboxRegisteredCommand,
  type SandboxRegisteredPanel,
} from "./protocol.ts";

export interface SandboxRuntimeOptions {
  transport: SandboxTransport;
  /** Host-provided loader keeps code download/caching outside the runtime. */
  loadPlugin: (manifest: PluginManifest) => Promise<EdgeEverPlugin>;
  /** Panel container root. Required when the plugin registers panels. */
  root?: HTMLElement;
  locale?: string;
  onError?: (scope: "runtime" | "activate" | "command" | "panel", error: unknown) => void;
}

export interface SandboxActivation {
  commands: SandboxRegisteredCommand[];
  panels: SandboxRegisteredPanel[];
}

export interface SandboxRuntime {
  /** Resolves once the host sends `init` and the plugin activated successfully. */
  readonly whenActivated: Promise<SandboxActivation>;
  dispose(): Promise<void>;
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

/**
 * Boots a plugin inside a WebView sandbox. The native host owns downloading,
 * persistence, and native UI; the sandbox runs plugin code and answers bridge
 * requests. Call this after the WebView document is ready.
 */
export const createSandboxRuntime = (options: SandboxRuntimeOptions): SandboxRuntime => {
  const bridge: SandboxBridge = createSandboxBridge(options.transport, {
    onProtocolError: (message) => options.onError?.("runtime", new Error(message)),
  });
  let plugin: EdgeEverPlugin | null = null;
  let pluginDisposer: (() => void | Promise<void>) | null = null;
  let contextHandle: SandboxContextHandle | null = null;
  let panelHost: PanelHost | null = null;
  let disposed = false;
  let initStarted = false;
  let resolveActivated: ((value: SandboxActivation) => void) | null = null;
  let rejectActivated: ((error: Error) => void) | null = null;

  const whenActivated = new Promise<SandboxActivation>((resolve, reject) => {
    resolveActivated = resolve;
    rejectActivated = reject;
  });

  const fail = (scope: "runtime" | "activate" | "command" | "panel", error: unknown) => {
    const normalized = asError(error);
    options.onError?.(scope, normalized);
    bridge.send({
      v: PLUGIN_SANDBOX_PROTOCOL_VERSION,
      type: "error",
      scope,
      message: normalized.message,
      ...(normalized.stack ? { stack: normalized.stack } : {}),
    });
  };

  const requireContext = (): SandboxContextHandle => {
    if (!contextHandle) throw new Error("Plugin context is not ready yet.");
    return contextHandle;
  };

  const activate = async (manifest: PluginManifest, platform: SandboxPlatform, settings?: Record<string, never>, locale?: string) => {
    if (!isSandboxPlatform(platform)) throw new Error(`Unsupported sandbox platform: ${String(platform)}`);
    if (!manifestSupportsPlatform(manifest, platform)) {
      throw new Error(`Plugin ${manifest.id} does not support the ${platform} platform.`);
    }
    plugin = await options.loadPlugin(manifest);
    if (typeof plugin !== "object" || plugin === null || typeof plugin.activate !== "function") {
      throw new Error("Plugin entry must default-export an object with activate(context).");
    }
    contextHandle = createSandboxPluginContext({
      bridge,
      manifest,
      platform,
      settings,
      locale,
    });
    if (options.root) {
      panelHost = createPanelHost({
        root: options.root,
        bridge,
        getPanel: (panelId) => requireContext().getPanel(panelId),
        onError: (error) => fail("panel", error),
      });
    }
    const disposer = await plugin.activate(contextHandle.context);
    pluginDisposer = typeof disposer === "function" ? disposer : null;
    const activation: SandboxActivation = {
      commands: contextHandle.registeredCommands(),
      panels: contextHandle.registeredPanels(),
    };
    bridge.send({
      v: PLUGIN_SANDBOX_PROTOCOL_VERSION,
      type: "activated",
      commands: activation.commands,
      panels: activation.panels,
    });
    resolveActivated?.(activation);
  };

  const handleInit = (message: Extract<SandboxInboundMessage, { type: "init" }>) => {
    if (initStarted) {
      fail("runtime", new Error("Sandbox received more than one init message."));
      return;
    }
    initStarted = true;
    void activate(message.manifest, message.platform, message.settings as Record<string, never> | undefined, message.locale)
      .catch((error) => {
        fail("activate", error);
        rejectActivated?.(asError(error));
      });
  };

  const unsubscribe = bridge.subscribe((message) => {
    if (message.type === "init") {
      handleInit(message);
      return;
    }
    if (message.type === "settings.changed") {
      contextHandle?.applySettingChange(message.key, message.value);
      contextHandle?.dispatchEvent("settings.changed", { key: message.key });
      return;
    }
    if (message.type === "event") {
      contextHandle?.dispatchEvent(message.event, message.payload as never);
      return;
    }
    if (message.type === "command.run") {
      void (async () => {
        try {
          const command = requireContext().getCommand(message.commandId);
          if (!command) throw new Error(`Plugin command not found: ${message.commandId}`);
          await command.run();
        } catch (error) {
          fail("command", error);
        }
      })();
      return;
    }
    if (message.type === "panel.open") {
      void (async () => {
        try {
          if (!panelHost) throw new Error("This sandbox has no panel host configured.");
          await panelHost.open(message.panelId, message.state ?? null);
        } catch (error) {
          fail("panel", error);
        }
      })();
      return;
    }
    if (message.type === "panel.close") {
      void panelHost?.close().catch((error) => fail("panel", error));
      return;
    }
  });

  bridge.send({ v: PLUGIN_SANDBOX_PROTOCOL_VERSION, type: "ready" });

  return {
    whenActivated,
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      try {
        if (pluginDisposer) await pluginDisposer();
        else await plugin?.deactivate?.();
      } catch (error) {
        options.onError?.("runtime", asError(error));
      }
      contextHandle?.dispose();
      await panelHost?.dispose();
      bridge.dispose();
    },
  };
};

/* ------------------------------------------------------------------ */
/* plugin module loading                                               */
/* ------------------------------------------------------------------ */

const unwrapModule = (module: { default?: unknown }): EdgeEverPlugin => {
  const candidate = module.default;
  const unwrapped = typeof candidate === "object" && candidate !== null && "default" in candidate
    ? (candidate as { default?: unknown }).default
    : candidate;
  if (typeof unwrapped !== "object" || unwrapped === null || typeof (unwrapped as { activate?: unknown }).activate !== "function") {
    throw new Error("Plugin entry must default-export an object with activate(context).");
  }
  return unwrapped as EdgeEverPlugin;
};

/** Import plugin code as an ES module from an object URL (works inside WebViews). */
export const importPluginFromCode = async (code: string): Promise<EdgeEverPlugin> => {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    const module = await import(/* @vite-ignore */ url) as { default?: unknown };
    return unwrapModule(module);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Download a plugin entry and import it as an ES module. */
export const importPluginFromUrl = async (url: string): Promise<EdgeEverPlugin> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to download plugin entry: HTTP ${response.status}`);
  return importPluginFromCode(await response.text());
};
