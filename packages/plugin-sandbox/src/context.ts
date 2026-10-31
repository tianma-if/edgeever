import type {
  PluginCommand,
  PluginContext,
  PluginEventMap,
  PluginManifest,
  PluginNote,
  PluginNoteContentQueryResult,
  PluginNoteQuery,
  PluginNoteQueryResult,
  PluginNoteRevision,
  PluginNotebook,
  PluginPanel,
  PluginPanelOpenOptions,
  PluginResource,
  PluginSettingValue,
  PluginTag,
  PluginTemplate,
} from "@edgeever/plugin-api";
import { SandboxUnsupportedError, type SandboxBridge } from "./bridge.ts";
import type { SandboxPlatform, SandboxRegisteredCommand, SandboxRegisteredPanel } from "./protocol.ts";
import { toRegisteredCommand, toRegisteredPanel } from "./protocol.ts";
import {
  deserializeBlob,
  deserializeResponse,
  headersToEntries,
  serializeBlob,
  serializeBody,
  serializeResponse,
  type SerializedBlob,
  type SerializedResponse,
} from "./transfer.ts";

export interface SandboxContextOptions {
  bridge: SandboxBridge;
  manifest: PluginManifest;
  platform: SandboxPlatform;
  locale?: string;
  settings?: Record<string, PluginSettingValue>;
}

export interface SandboxContextHandle {
  context: PluginContext;
  /** Snapshot of commands/panels registered during activation. */
  registeredCommands(): SandboxRegisteredCommand[];
  registeredPanels(): SandboxRegisteredPanel[];
  getCommand(id: string): PluginCommand | undefined;
  getPanel(id: string): PluginPanel | undefined;
  /** Host-driven events, forwarded to `context.events.on` listeners. */
  dispatchEvent<K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K]): void;
  /** Host pushes a persisted setting change; keeps the local snapshot fresh. */
  applySettingChange(key: string, value: PluginSettingValue | null): void;
  dispose(): void;
}

const unsupported = (api: string): never => {
  throw new SandboxUnsupportedError(api);
};

const unsupportedAsync = <T>(api: string): Promise<T> => Promise.reject(new SandboxUnsupportedError(api));

export const createSandboxPluginContext = (options: SandboxContextOptions): SandboxContextHandle => {
  const { bridge, manifest, platform } = options;
  const settings = { ...(options.settings ?? {}) };
  const commands = new Map<string, PluginCommand>();
  const panels = new Map<string, PluginPanel>();
  const eventListeners = new Map<keyof PluginEventMap, Set<(payload: never) => void>>();
  const commandDisposers = new Set<() => void>();
  const panelDisposers = new Set<() => void>();
  const eventDisposers = new Set<() => void>();
  let disposed = false;

  const request = <T>(method: Parameters<SandboxBridge["request"]>[0], params?: unknown, timeoutMs?: number): Promise<T> =>
    bridge.request<T>(method, params, timeoutMs ? { timeoutMs } : undefined);

  const context: PluginContext = {
    pluginId: manifest.id,
    ai: {
      status: () => unsupportedAsync("context.ai.status"),
      generate: () => unsupportedAsync("context.ai.generate"),
      transcribeResource: () => unsupportedAsync("context.ai.transcribeResource"),
      transcribeMedia: () => unsupportedAsync("context.ai.transcribeMedia"),
    },
    notes: {
      query: (input?: PluginNoteQuery) => request<PluginNoteQueryResult>("notes.query", input),
      queryContent: (input?: PluginNoteQuery) => request<PluginNoteContentQueryResult>("notes.queryContent", input),
      get: (noteId: string) => request<PluginNote>("notes.get", { noteId }),
      editMarkdown: (noteId, input) => request<PluginNote>("notes.editMarkdown", { noteId, input }),
      create: (input) => request<PluginNote>("notes.create", input),
      update: (noteId, input) => request<PluginNote>("notes.update", { noteId, input }),
      delete: (noteId, apiOptions) => request<void>("notes.delete", { noteId, permanent: apiOptions?.permanent === true }),
      move: (noteIds, notebookId) => request<number>("notes.move", { noteIds, notebookId }),
      pin: (noteIds, isPinned) => request<number>("notes.pin", { noteIds, isPinned }),
      restore: (noteId) => request<PluginNote>("notes.restore", { noteId }),
      revisions: {
        list: (noteId) => request<PluginNoteRevision[]>("notes.revisions.list", { noteId }),
        restore: (noteId, revisionId) => request<PluginNote>("notes.revisions.restore", { noteId, revisionId }),
      },
    },
    diagrams: {
      get: () => unsupportedAsync("context.diagrams"),
      edit: () => unsupportedAsync("context.diagrams"),
    },
    tables: {
      get: () => unsupportedAsync("context.tables"),
      edit: () => unsupportedAsync("context.tables"),
    },
    posters: {
      capabilities: () => unsupportedAsync("context.posters"),
      get: () => unsupportedAsync("context.posters"),
      edit: () => unsupportedAsync("context.posters"),
    },
    infographics: {
      capabilities: () => unsupportedAsync("context.infographics"),
      get: () => unsupportedAsync("context.infographics"),
      edit: () => unsupportedAsync("context.infographics"),
    },
    notebooks: {
      list: () => request<PluginNotebook[]>("notebooks.list"),
      create: (input) => request<PluginNotebook>("notebooks.create", input),
      update: (notebookId, input) => request<PluginNotebook>("notebooks.update", { notebookId, input }),
      delete: (notebookId) => request<void>("notebooks.delete", { notebookId }),
    },
    tags: {
      list: () => request<PluginTag[]>("tags.list"),
      rename: (name, nextName) => request<number>("tags.rename", { name, nextName }),
      delete: (name) => request<number>("tags.delete", { name }),
    },
    templates: {
      list: () => request<PluginTemplate[]>("templates.list"),
      create: (input) => request<PluginTemplate>("templates.create", input),
      update: (templateId, input) => request<PluginTemplate>("templates.update", { templateId, input }),
      delete: (templateId) => request<void>("templates.delete", { templateId }),
      use: (templateId, notebookId) => request<PluginNote>("templates.use", { templateId, notebookId }),
    },
    commands: {
      register(command) {
        if (disposed) throw new Error("Plugin context has been disposed.");
        commands.set(command.id, command);
        const dispose = () => commands.delete(command.id);
        commandDisposers.add(dispose);
        return () => {
          commandDisposers.delete(dispose);
          dispose();
        };
      },
    },
    schedules: {
      upsert: () => unsupportedAsync("context.schedules"),
      list: () => unsupportedAsync("context.schedules"),
      remove: () => unsupportedAsync("context.schedules"),
    },
    events: {
      on(event, listener) {
        const listeners = eventListeners.get(event) ?? new Set();
        const entry = listener as (payload: never) => void;
        listeners.add(entry);
        eventListeners.set(event, listeners);
        const dispose = () => listeners.delete(entry);
        eventDisposers.add(dispose);
        return () => {
          eventDisposers.delete(dispose);
          dispose();
        };
      },
    },
    storage: {
      get: <T>(key: string) => request<T | null>("storage.get", { key }),
      set: <T>(key: string, value: T) => request<void>("storage.set", { key, value }),
      remove: (key: string) => request<void>("storage.remove", { key }),
    },
    secrets: {
      get: (key) => request<string | null>("secrets.get", { key }),
      set: (key, value) => request<void>("secrets.set", { key, value }),
      remove: (key) => request<void>("secrets.remove", { key }),
    },
    editor: {
      getSelection: () => unsupportedAsync("context.editor"),
      getDocument: () => unsupportedAsync("context.editor"),
      editMarkdown: () => unsupportedAsync("context.editor"),
      insertEmbed: () => unsupportedAsync("context.editor"),
      embeds: { register: () => unsupported("context.editor.embeds") },
      replaceSelection: () => unsupportedAsync("context.editor"),
      insertAtCursor: () => unsupportedAsync("context.editor"),
    },
    resources: {
      list: (noteId?: string) => request<PluginResource[]>("resources.list", noteId ? { noteId } : undefined),
      read: async (resourceId: string) => {
        const blob = await request<SerializedBlob>("resources.read", { resourceId });
        return deserializeBlob(blob);
      },
      upload: () => unsupportedAsync("context.resources.upload"),
      update: () => unsupportedAsync("context.resources.update"),
      rename: () => unsupportedAsync("context.resources.rename"),
      delete: () => unsupportedAsync("context.resources.delete"),
    },
    settings: {
      get: async (key) => (Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : null),
      set: async (key, value) => {
        await request<void>("settings.set", { key, value });
        settings[key] = value;
      },
      remove: async (key) => {
        await request<void>("settings.remove", { key });
        delete settings[key];
      },
    },
    network: {
      async fetch(input, init) {
        if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        const body = await serializeBody(init?.body ?? null);
        const payload = await request<SerializedResponse>("network.fetch", {
          url: typeof input === "string" ? input : String(input),
          method: (init?.method ?? "GET").toUpperCase(),
          headers: headersToEntries(init?.headers),
          body,
          redirect: init?.redirect,
          credentials: init?.credentials,
          ...(init && "transport" in init ? { transport: (init as { transport?: string }).transport } : {}),
        }, 120_000);
        if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        return deserializeResponse(payload);
      },
    },
    ui: {
      showNotice: (message: string) => {
        bridge.notify({ v: bridge.protocol, type: "notice", message });
      },
      openNote: (noteId, apiOptions) => request<void>("ui.openNote", { noteId, search: apiOptions?.search }),
      panels: {
        register(panel) {
          if (disposed) throw new Error("Plugin context has been disposed.");
          panels.set(panel.id, panel);
          const dispose = () => panels.delete(panel.id);
          panelDisposers.add(dispose);
          return () => {
            panelDisposers.delete(dispose);
            dispose();
          };
        },
        open: (panelId: string, apiOptions?: PluginPanelOpenOptions) =>
          request<void>("panel.open", { panelId, state: apiOptions?.state ?? null }),
      },
    },
  };

  return {
    context,
    registeredCommands: () => [...commands.values()].map(toRegisteredCommand),
    registeredPanels: () => [...panels.values()].map(toRegisteredPanel),
    getCommand: (id) => commands.get(id),
    getPanel: (id) => panels.get(id),
    dispatchEvent(event, payload) {
      const listeners = eventListeners.get(event as keyof PluginEventMap);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          (listener as (value: unknown) => void)(payload);
        } catch {
          /* listener errors must not break the sandbox runtime */
        }
      }
    },
    applySettingChange(key, value) {
      if (value === null) delete settings[key];
      else settings[key] = value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of [...commandDisposers, ...panelDisposers, ...eventDisposers]) dispose();
      commandDisposers.clear();
      panelDisposers.clear();
      eventDisposers.clear();
      commands.clear();
      panels.clear();
      eventListeners.clear();
    },
  };
};

