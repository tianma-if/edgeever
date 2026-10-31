import type { PluginJsonValue, PluginPanel, PluginPanelChrome, PluginPanelMountContext } from "@edgeever/plugin-api";
import { normalizePluginPanelChrome } from "@edgeever/plugin-api";
import type { SandboxBridge } from "./bridge.ts";
import { serializePanelChrome } from "./protocol.ts";

export interface PanelHostOptions {
  root: HTMLElement;
  bridge: SandboxBridge;
  getPanel: (panelId: string) => PluginPanel | undefined;
  /** Optional container factory so tests and non-browser hosts can mount panels. */
  createContainer?: (root: HTMLElement) => HTMLElement;
  onError?: (error: unknown) => void;
}

export interface PanelHost {
  open(panelId: string, state?: PluginJsonValue | null): Promise<void>;
  close(): Promise<void>;
  readonly activePanelId: string | null;
  dispose(): Promise<void>;
}

interface ActivePanel {
  panelId: string;
  panel: PluginPanel;
  container: HTMLElement;
  dispose: (() => void) | null;
}

const defaultCreateContainer = (root: HTMLElement): HTMLElement => {
  const container = root.ownerDocument.createElement("div");
  container.className = "edgeever-plugin-panel";
  return container;
};

/**
 * Mounts plugin panels inside the sandbox document and mirrors host-owned chrome
 * (header/toolbar/empty state) across the bridge. The native side renders the
 * chrome in native UI; the sandbox only reports intent.
 */
export const createPanelHost = (options: PanelHostOptions): PanelHost => {
  const { root, bridge, getPanel } = options;
  const createContainer = options.createContainer ?? defaultCreateContainer;
  const chromeCallbacks = new Map<string, Required<Pick<PluginPanelChrome, "onAction" | "onChange">>>();
  let active: ActivePanel | null = null;
  let disposed = false;

  const callbacksFor = (panelId: string) => {
    const existing = chromeCallbacks.get(panelId);
    if (existing) return existing;
    const created = { onAction: undefined, onChange: undefined } as unknown as Required<Pick<PluginPanelChrome, "onAction" | "onChange">>;
    chromeCallbacks.set(panelId, created);
    return created;
  };

  const reportError = (error: unknown) => {
    options.onError?.(error);
    bridge.send({
      v: bridge.protocol,
      type: "error",
      scope: "panel",
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const close = async (): Promise<void> => {
    const current = active;
    if (!current) {
      root.replaceChildren();
      return;
    }
    active = null;
    try {
      current.dispose?.();
    } catch (error) {
      reportError(error);
    }
    current.container.remove();
    root.replaceChildren();
    chromeCallbacks.delete(current.panelId);
  };

  const open = async (panelId: string, state: PluginJsonValue | null = null): Promise<void> => {
    if (disposed) throw new Error("Panel host has been disposed.");
    const panel = getPanel(panelId);
    if (!panel) throw new Error(`Plugin panel not found: ${panelId}`);
    await close();
    const container = createContainer(root);
    root.replaceChildren(container);
    callbacksFor(panelId);
    const mountContext: PluginPanelMountContext = {
      state,
      requestClose: async () => {
        bridge.notify({ v: bridge.protocol, type: "panel.close-request", panelId });
      },
      shell: {
        set(chrome: PluginPanelChrome) {
          const normalized = normalizePluginPanelChrome(chrome);
          chromeCallbacks.set(panelId, {
            onAction: normalized.onAction,
            onChange: normalized.onChange,
          } as Required<Pick<PluginPanelChrome, "onAction" | "onChange">>);
          bridge.notify({
            v: bridge.protocol,
            type: "panel.chrome",
            panelId,
            chrome: serializePanelChrome(normalized),
          });
        },
      },
    };
    const dispose = await panel.mount(container, mountContext);
    active = {
      panelId,
      panel,
      container,
      dispose: typeof dispose === "function" ? dispose : null,
    };
  };

  bridge.handle("panel.beforeClose", async () => {
    if (!active?.panel.beforeClose) return true;
    const decision = await active.panel.beforeClose();
    return decision === undefined ? true : decision;
  });

  const unsubscribe = bridge.subscribe((message) => {
    if (message.type === "panel.action") {
      const callbacks = chromeCallbacks.get(message.panelId);
      if (!callbacks?.onAction) return;
      try {
        callbacks.onAction(message.actionId);
      } catch (error) {
        reportError(error);
      }
      return;
    }
    if (message.type === "panel.change") {
      const callbacks = chromeCallbacks.get(message.panelId);
      if (!callbacks?.onChange) return;
      try {
        callbacks.onChange(message.key, message.value);
      } catch (error) {
        reportError(error);
      }
      return;
    }
    if (message.type === "panel.close") {
      void close().catch(reportError);
    }
  });

  return {
    open,
    close,
    get activePanelId() {
      return active?.panelId ?? null;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      await close();
    },
  };
};
