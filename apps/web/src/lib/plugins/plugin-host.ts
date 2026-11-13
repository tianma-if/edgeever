import {
  PLUGIN_API_VERSION,
  parseExtensionManifest,
  type MarketplaceEntry,
  type EdgeEverPlugin,
  type ExtensionManifest,
  type PluginCommand,
  type PluginContext,
  type PluginEventMap,
  type PluginEditorDocument,
  type PluginEmbedInstance,
  type PluginEmbedRenderer,
  type PluginManifest,
  type PluginMarkdownEdit,
  type PluginNote,
  type PluginNoteRevision,
  type PluginNoteSummary,
  type PluginPanel,
  type PluginOpenNoteOptions,
  type PluginPanelChrome,
  type PluginPanelCloseDecision,
  type PluginPanelOpenOptions,
  normalizePluginPanelChrome,
  type PluginPermission,
  type PluginApiErrorCode,
  type PluginResource,
  type PluginSchedule,
  type PluginScheduleInput,
  type PluginSettingField,
  type PluginSettingValue,
  type PluginEditorSelection,
  type PluginTemplate,
  type ThemeManifest,
  type ThemeTokenName,
  type ThemeTokens,
} from "@edgeever/plugin-api";
import { markdownToDoc, type MemoDetail } from "@edgeever/shared";
import {
  structuredEditToken, pluginNoteKind, assertPluginMarkdownNote, assertStructuredRevision, pluginDiagram, pluginTable,
  translateStructuredError, applyDiagramOperations, applyTableOperations, diagramSemanticGraph,
  serializeTableDocument, tableFallbackMarkdown, structuredApiError,
  posterCapabilities, pluginPoster, pluginInfographic, applyPosterEdits, applyInfographicOperations, serializePosterDocument, serializeInfographicDocument,
} from "./structured-note-api";
import type { EdgeEverRepository } from "@/lib/repository";
import { WebPluginSecretStore, type PluginSecretStorage } from "@/lib/plugins/plugin-secret-store";
import { WebPluginPackageStore, type CachedPluginPackage, type PluginPackageStorage } from "@/lib/plugins/plugin-package-store";
import { isPluginIdRevoked } from "@/lib/plugins/community-registry-store";
import { downloadGithubExtension, downloadPinnedGithubExtension, extensionManifestsEqual, parseGithubRepositoryUrl, sha256Hex } from "@/lib/plugins/github-plugin-distribution";
import {
  catalogInstallSource,
  planCatalogReconcile,
  toLocalCatalogExtension,
  toWorkspaceExtensionUpsert,
  type PluginCatalogAdapter,
} from "@/lib/plugins/plugin-catalog-sync";
import { loadResolvedPluginMarketplace } from "@/lib/plugins/plugin-marketplace";
import { hasAcknowledgedPluginTrustWarning } from "@/lib/plugins/plugin-trust";
import { subscribeRepositoryMutations, type RepositoryMutationEvent } from "@/lib/repository-events";
import type { WorkspaceExtension } from "@edgeever/shared";

const INSTALLED_EXTENSIONS_STORAGE_KEY = "edgeever.extensions.installed.v1";
const ACTIVE_THEME_STORAGE_KEY = "edgeever.extensions.active-theme.v1";
const STORAGE_PREFIX = "edgeever.plugin-data.v1";
const SETTINGS_STORAGE_PREFIX = "edgeever.plugin-settings.v1";

const readStorageItem = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageItem = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    throw new Error("Browser storage is unavailable or full.");
  }
};

const removeStorageItem = (key: string) => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    throw new Error("Browser storage is unavailable.");
  }
};

const clearStoragePrefix = (prefix: string) => {
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    throw new Error("Browser storage is unavailable.");
  }
};

const THEME_TOKEN_CSS_VARIABLES: Record<ThemeTokenName, string> = {
  "color.background": "--edgeever-theme-background",
  "color.surface": "--edgeever-theme-surface",
  "color.surfaceMuted": "--edgeever-theme-surface-muted",
  "color.text": "--edgeever-theme-text",
  "color.textMuted": "--edgeever-theme-text-muted",
  "color.border": "--edgeever-theme-border",
  "color.accent": "--edgeever-theme-accent",
  "color.accentForeground": "--edgeever-theme-accent-foreground",
  "color.success": "--edgeever-theme-success",
  "color.warning": "--edgeever-theme-warning",
  "color.danger": "--edgeever-theme-danger",
  "font.body": "--edgeever-theme-font-body",
  "font.mono": "--edgeever-theme-font-mono",
  "font.size": "--edgeever-theme-font-size",
  "lineHeight.body": "--edgeever-theme-line-height",
  "radius.medium": "--edgeever-theme-radius",
  "density.scale": "--edgeever-theme-density",
  "editor.contentWidth": "--editor-content-max-width",
};

export interface InstalledExtension {
  manifestUrl: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  installedAt: string;
  catalogUpdatedAt: string;
  error: string | null;
  source: ExtensionInstallSource;
}

export interface ExtensionInstallSource {
  kind: "manifest" | "github" | "marketplace";
  repositoryUrl?: string;
  releaseTag?: string;
  verified: boolean;
  publisher?: "edgeever";
}

export interface RegisteredPluginCommand {
  pluginId: string;
  id: string;
  title: string;
  listed?: boolean;
  menu?: boolean;
}

export interface RegisteredPluginPanel {
  pluginId: string;
  id: string;
  title: string;
  purpose?: "workflow" | "dashboard" | "preview" | "onboarding";
  presentation: "dialog" | "fullscreen";
}

export interface RegisteredPluginEmbed {
  pluginId: string;
  type: string;
}

export interface RegisteredPluginAction {
  pluginId: string;
  id: string;
  title: string;
  type: "command" | "panel";
}

export interface PluginEditorAdapter {
  getSelection(): PluginEditorSelection | null;
  getDocument(): PluginEditorDocument | null;
  replaceDocument(contentMarkdown: string): void;
  insertEmbed(embed: PluginEmbedInstance): void;
  replaceSelection(contentMarkdown: string): void;
  insertAtCursor(contentMarkdown: string): void;
}

export interface PluginNavigationAdapter {
  openNote(noteId: string, notebookId: string, options?: PluginOpenNoteOptions): void | Promise<void>;
}

export interface PluginPanelChromeAdapter {
  set(chrome: PluginPanelChrome): void;
}

export interface PluginPanelAdapter {
  openPanel(pluginId: string, panelId: string, options?: PluginPanelOpenOptions): void | Promise<void>;
}

export interface PluginScheduleAdapter {
  upsert(pluginId: string, input: PluginScheduleInput): Promise<PluginSchedule>;
  list(pluginId: string): Promise<PluginSchedule[]>;
  remove(pluginId: string, key: string): Promise<void>;
}

export interface PluginHostSnapshot {
  catalogErrors: { extensionId: string | null; message: string }[];
  extensions: InstalledExtension[];
  commands: RegisteredPluginCommand[];
  panels: RegisteredPluginPanel[];
  embeds: RegisteredPluginEmbed[];
  activeThemeId: string | null;
}

interface PluginHostOptions {
  repository: EdgeEverRepository;
  scope: string;
  aiAdapter?: Pick<PluginContext['ai'], 'status' | 'generate'>;
  publicNetworkAdapter?: {
    fetchPublic(input: { url: string; method: 'GET' | 'HEAD'; headers: Record<string, string> }, options?: { signal?: AbortSignal }): Promise<{ status: number; statusText: string; url: string; headers: Record<string, string>; body: ArrayBuffer }>;
  };
  onWorkspaceChanged?: () => void | Promise<void>;
  onNotice?: (message: string) => void;
  secretStorage?: PluginSecretStorage;
  packageStorage?: PluginPackageStorage;
  scheduleAdapter?: PluginScheduleAdapter;
  catalogAdapter?: PluginCatalogAdapter;
}

interface ActivePlugin {
  plugin: EdgeEverPlugin;
  disposers: Array<() => void>;
}

const toPluginNoteSummary = (note: Awaited<ReturnType<EdgeEverRepository["listMemos"]>>["memos"][number]): PluginNoteSummary => ({
  kind: pluginNoteKind(note),
  id: note.id,
  notebookId: note.notebookId,
  title: note.title,
  excerpt: note.excerpt,
  tags: [...note.tags],
  isPinned: note.isPinned,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

const toPluginNote = (note: Awaited<ReturnType<EdgeEverRepository["getMemo"]>>["memo"]): PluginNote => ({
  ...toPluginNoteSummary(note),
  contentJson: structuredClone(note.contentJson),
  revision: note.revision,
  contentMarkdown: note.contentMarkdown,
  contentText: note.contentText,
  contentHash: note.contentHash,
});

const toPluginNotebook = (notebook: Awaited<ReturnType<EdgeEverRepository["listNotebooks"]>>["notebooks"][number]) => ({
  id: notebook.id,
  parentId: notebook.parentId,
  name: notebook.name,
  memoCount: notebook.memoCount,
});

const toPluginRevision = (revision: Awaited<ReturnType<EdgeEverRepository["listMemoRevisions"]>>["revisions"][number]): PluginNoteRevision => ({
  id: revision.id,
  noteId: revision.memoId,
  revision: revision.revision,
  title: revision.title,
  tags: [...revision.tags],
  contentMarkdown: revision.contentMarkdown,
  contentText: revision.contentText,
  createdAt: revision.createdAt,
});

const toPluginResource = (resource: Awaited<ReturnType<EdgeEverRepository["uploadMemoResource"]>>["resource"]): PluginResource => ({
  id: resource.id,
  noteId: resource.memoId,
  kind: resource.kind,
  mimeType: resource.mimeType,
  filename: resource.filename,
  byteSize: resource.byteSize,
  contentHash: resource.sha256,
  width: resource.width,
  height: resource.height,
  createdAt: resource.createdAt,
  updatedAt: resource.updatedAt,
  url: resource.url,
});

const toPluginTemplate = (template: Awaited<ReturnType<EdgeEverRepository["listTemplates"]>>["templates"][number]): PluginTemplate => ({
  id: template.id,
  name: template.name,
  description: template.description,
  title: template.title,
  contentMarkdown: template.contentMarkdown,
  tags: [...template.tags],
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const createPluginApiError = (code: PluginApiErrorCode, message: string) => Object.assign(new Error(message), { code });

const isUtf16Boundary = (value: string, offset: number) => {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
};

export const applyPluginMarkdownEdits = (contentMarkdown: string, edits: PluginMarkdownEdit[]) => {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw createPluginApiError("INVALID_MARKDOWN_EDIT", "At least one Markdown edit is required.");
  }
  const ordered = edits.map((edit) => ({ ...edit })).sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index];
    if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to) || typeof edit.insert !== "string") {
      throw createPluginApiError("INVALID_MARKDOWN_EDIT", "Markdown edit offsets must be safe integers and insert must be a string.");
    }
    if (edit.from < 0 || edit.to < edit.from || edit.to > contentMarkdown.length) {
      throw createPluginApiError("INVALID_MARKDOWN_EDIT", "Markdown edit range is outside the current note.");
    }
    if (!isUtf16Boundary(contentMarkdown, edit.from) || !isUtf16Boundary(contentMarkdown, edit.to)) {
      throw createPluginApiError("INVALID_MARKDOWN_EDIT", "Markdown edit range cannot split a Unicode surrogate pair.");
    }
    if (index > 0 && edit.from < ordered[index - 1].to) {
      throw createPluginApiError("INVALID_MARKDOWN_EDIT", "Markdown edit ranges cannot overlap.");
    }
  }
  return ordered.reduceRight(
    (markdown, edit) => `${markdown.slice(0, edit.from)}${edit.insert}${markdown.slice(edit.to)}`,
    contentMarkdown,
  );
};

const normalizeInstallSource = (value: unknown): ExtensionInstallSource => {
  if (!value || typeof value !== "object") return { kind: "manifest", verified: false };
  const candidate = value as Partial<ExtensionInstallSource>;
  if (candidate.kind !== "manifest" && candidate.kind !== "github" && candidate.kind !== "marketplace") {
    return { kind: "manifest", verified: false };
  }
  return {
    kind: candidate.kind,
    verified: candidate.kind === "marketplace" && candidate.verified === true,
    ...(typeof candidate.repositoryUrl === "string" ? { repositoryUrl: candidate.repositoryUrl } : {}),
    ...(typeof candidate.releaseTag === "string" ? { releaseTag: candidate.releaseTag } : {}),
    ...(candidate.publisher === "edgeever" ? { publisher: "edgeever" } : {}),
  };
};

const readInstalledExtensions = (): InstalledExtension[] => {
  try {
    const parsed = JSON.parse(readStorageItem(INSTALLED_EXTENSIONS_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      try {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<InstalledExtension>;
        if (typeof candidate.manifestUrl !== "string") return [];
        const installedAt = typeof candidate.installedAt === "string" ? candidate.installedAt : new Date().toISOString();
        return [{
          manifestUrl: candidate.manifestUrl,
          manifest: parseExtensionManifest(candidate.manifest),
          enabled: Boolean(candidate.enabled),
          installedAt,
          catalogUpdatedAt: typeof candidate.catalogUpdatedAt === "string" ? candidate.catalogUpdatedAt : installedAt,
          error: typeof candidate.error === "string" ? candidate.error : null,
          source: normalizeInstallSource(candidate.source),
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

const assertPermission = (manifest: PluginManifest, permission: PluginPermission) => {
  // Enabled plugins are trusted code. Capability declarations are descriptive metadata,
  // retained for compatibility and user review rather than runtime authorization.
  void manifest;
  void permission;
};

const EVENT_PERMISSIONS: Partial<Record<keyof PluginEventMap, PluginPermission>> = {
  "note.created": "notes:read",
  "note.updated": "notes:read",
  "note.deleted": "notes:read",
  "tag.changed": "metadata:read",
  "template.created": "templates:read",
  "template.updated": "templates:read",
  "template.deleted": "templates:read",
  "resource.created": "resources:read",
  "resource.updated": "resources:read",
  "resource.deleted": "resources:read",
};

const resolveManifestEntry = (manifestUrl: string, entry: string) => new URL(entry, manifestUrl).href;

const assertConfirmedManifest = (confirmedManifest: ExtensionManifest | undefined, downloadedManifest: ExtensionManifest) => {
  if (confirmedManifest && !extensionManifestsEqual(confirmedManifest, downloadedManifest)) {
    throw new Error("The extension manifest changed after update confirmation. Review the update again.");
  }
};

const requireSettingField = (manifest: PluginManifest, key: string) => {
  const field = manifest.settings?.fields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`${manifest.name} has not declared the ${key} setting.`);
  return field;
};

const validateSettingValue = (field: PluginSettingField, value: PluginSettingValue) => {
  if (field.type === "text" || field.type === "secret") {
    if (typeof value !== "string") throw new Error(`${field.label} must be a string.`);
    if (field.required && !value.trim()) throw new Error(`${field.label} is required.`);
    return value;
  }
  if (field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.label} must be a finite number.`);
    if (field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}.`);
    if (field.max !== undefined && value > field.max) throw new Error(`${field.label} must be at most ${field.max}.`);
    return value;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${field.label} must be true or false.`);
    return value;
  }
  if (typeof value !== "string" || !field.options.some((option) => option.value === value)) {
    throw new Error(`${field.label} must match an available option.`);
  }
  return value;
};

const normalizePanelState = (state: PluginPanelOpenOptions["state"] | undefined) => {
  if (state === undefined) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(state);
  } catch {
    throw new Error("Plugin panel state must be JSON-serializable.");
  }
  if (serialized === undefined || serialized.length > 64 * 1024) {
    throw new Error("Plugin panel state must be JSON-serializable and at most 64 KiB.");
  }
  return JSON.parse(serialized) as NonNullable<PluginPanelOpenOptions["state"]>;
};

export class EdgeEverPluginHost {
  private readonly aiAdapter?: PluginHostOptions['aiAdapter'];
  private readonly publicNetworkAdapter?: PluginHostOptions['publicNetworkAdapter'];
  private readonly repository: EdgeEverRepository;
  private readonly scope: string;
  private readonly onWorkspaceChanged?: () => void | Promise<void>;
  private readonly onNotice?: (message: string) => void;
  private readonly secretStorage: PluginSecretStorage;
  private readonly packageStorage: PluginPackageStorage;
  private readonly scheduleAdapter?: PluginScheduleAdapter;
  private readonly catalogAdapter?: PluginCatalogAdapter;
  private catalogSyncSuspended = 0;
  private catalogErrors: PluginHostSnapshot["catalogErrors"] = [];
  private readonly listeners = new Set<() => void>();
  private readonly activePlugins = new Map<string, ActivePlugin>();
  private readonly commands = new Map<string, PluginCommand & { pluginId: string }>();
  private readonly panels = new Map<string, PluginPanel & { pluginId: string }>();
  private readonly mountedPanels = new Map<string, Set<() => void>>();
  private readonly embeds = new Map<string, PluginEmbedRenderer & { pluginId: string }>();
  private readonly mountedEmbeds = new Map<string, Set<() => void>>();
  private readonly eventListeners = new Map<keyof PluginEventMap, Set<{ pluginId: string; listener: (payload: never) => void }>>();
  private extensions = readInstalledExtensions();
  private activeThemeId = readStorageItem(ACTIVE_THEME_STORAGE_KEY);
  private snapshot: PluginHostSnapshot = { catalogErrors: [], extensions: [], commands: [], panels: [], embeds: [], activeThemeId: null };
  private editorAdapter: PluginEditorAdapter | null = null;
  private navigationAdapter: PluginNavigationAdapter | null = null;
  private panelAdapter: PluginPanelAdapter | null = null;
  private themeObserver: MutationObserver | null = null;
  private repositoryEventDisposer: (() => void) | null = null;
  private started = false;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private readonly activatingPlugins = new Map<string, Promise<void>>();

  private enqueueLifecycle<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.lifecycleQueue.then(action, action);
    this.lifecycleQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  constructor(options: PluginHostOptions) {
    this.aiAdapter = options.aiAdapter;
    this.publicNetworkAdapter = options.publicNetworkAdapter;
    this.repository = options.repository;
    this.scope = options.scope;
    this.onWorkspaceChanged = options.onWorkspaceChanged;
    this.onNotice = options.onNotice;
    this.secretStorage = options.secretStorage ?? new WebPluginSecretStore();
    this.packageStorage = options.packageStorage ?? new WebPluginPackageStore();
    this.scheduleAdapter = options.scheduleAdapter;
    this.catalogAdapter = options.catalogAdapter;
    this.refreshSnapshot();
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  setEditorAdapter(adapter: PluginEditorAdapter | null) {
    this.editorAdapter = adapter;
    return () => {
      if (this.editorAdapter === adapter) this.editorAdapter = null;
    };
  }

  setNavigationAdapter(adapter: PluginNavigationAdapter | null) {
    this.navigationAdapter = adapter;
    return () => {
      if (this.navigationAdapter === adapter) this.navigationAdapter = null;
    };
  }

  setPanelAdapter(adapter: PluginPanelAdapter | null) {
    this.panelAdapter = adapter;
    return () => {
      if (this.panelAdapter === adapter) this.panelAdapter = null;
    };
  }

  activateEnabled() {
    return this.enqueueLifecycle(async () => {
    this.start();
    const pendingTrustPluginIds = await this.syncFromCatalogOnce();
    for (const extension of this.extensions) {
      if (!extension.enabled || extension.manifest.type !== "plugin") continue;
      await this.activatePlugin(extension.manifest.id).catch(() => undefined);
    }
    this.applyActiveTheme();
    return pendingTrustPluginIds;
    });
  }

  syncFromCatalog() {
    return this.enqueueLifecycle(async () => this.syncFromCatalogOnce());
  }

  private async syncFromCatalogOnce() {
    if (!this.catalogAdapter) return [] as string[];
    let remote: WorkspaceExtension[];
    try {
      remote = await this.catalogAdapter.list();
    } catch (error) {
      this.catalogErrors = [{ extensionId: null, message: error instanceof Error ? error.message : String(error) }];
      this.refreshSnapshot();
      console.error("Workspace extension catalog sync failed.", error);
      return [];
    }

    this.catalogErrors = [];
    let officialIds = new Set<string>();
    try {
      const marketplace = await loadResolvedPluginMarketplace();
      officialIds = new Set(
        marketplace.entries.filter((entry) => entry.publisher === "edgeever").map((entry) => entry.id),
      );
    } catch {
      officialIds = new Set();
    }

    const actions = planCatalogReconcile({
      local: this.extensions.map(toLocalCatalogExtension),
      remote,
      hasTrustAcknowledgement: hasAcknowledgedPluginTrustWarning(),
      officialIds,
    });
    const pendingTrustPluginIds: string[] = [];
    const failed = new Set<string>();
    this.catalogSyncSuspended += 1;
    try {
      for (const action of actions) {
        try {
          if (action.type === "uninstall") {
            await this.uninstall(action.extensionId);
            continue;
          }
          if (action.type === "install") {
            await this.installFromCatalogEntry(action.entry);
            this.patchCatalogUpdatedAt(action.entry.extensionId, action.entry.updatedAt);
            continue;
          }
          if (action.type === "setEnabled") {
            if (failed.has(action.extensionId) || !this.extensions.some((item) => item.manifest.id === action.extensionId)) continue;
            await this.setEnabled(action.extensionId, action.enabled);
            const remoteEntry = remote.find((item) => item.extensionId === action.extensionId);
            if (remoteEntry && !remoteEntry.deletedAt) this.patchCatalogUpdatedAt(action.extensionId, remoteEntry.updatedAt);
            continue;
          }
          if (action.type === "awaitTrust") {
            if (!failed.has(action.extensionId)) pendingTrustPluginIds.push(action.extensionId);
            continue;
          }
          const extension = this.extensions.find((item) => item.manifest.id === action.extensionId);
          if (extension) await this.pushCatalog(extension, { ignoreSuspend: true });
        } catch (error) {
          const extensionId = action.type === "install" ? action.entry.extensionId : action.extensionId;
          this.catalogErrors.push({ extensionId, message: error instanceof Error ? error.message : String(error) });
          if (action.type === "install") failed.add(action.entry.extensionId);
          console.error("Workspace extension catalog sync failed.", error);
        }
      }
    } finally {
      this.catalogSyncSuspended -= 1;
      this.refreshSnapshot();
    }
    return pendingTrustPluginIds;
  }

  private async installFromCatalogEntry(entry: WorkspaceExtension) {
    if ((entry.sourceKind === "github" || entry.sourceKind === "marketplace") && entry.repositoryUrl) {
      const downloaded = await downloadPinnedGithubExtension(entry.repositoryUrl, entry.version);
      return this.replaceInstalledExtension(
        downloaded.manifest,
        downloaded.manifestUrl,
        catalogInstallSource({
          ...entry,
          repositoryUrl: downloaded.repositoryUrl,
          releaseTag: downloaded.releaseTag ?? entry.releaseTag,
        }),
        downloaded.pluginPackage,
      );
    }
    return this.installFromManifestUrl(entry.manifestUrl);
  }

  async installFromSource(input: string) {
    if (parseGithubRepositoryUrl(input)) return this.installFromGithubRepository(input);
    return this.installFromManifestUrl(input);
  }

  async installFromGithubRepository(input: string, marketplaceEntry?: MarketplaceEntry, confirmedManifest?: ExtensionManifest) {
    // Official marketplace entries carry the live GitHub version after marketplace resolution.
    const downloaded = marketplaceEntry
      ? await downloadPinnedGithubExtension(input, marketplaceEntry.verification.version, {
        requireStyles: Boolean(marketplaceEntry.verification.checksums?.stylesCss),
      })
      : await downloadGithubExtension(input);
    assertConfirmedManifest(confirmedManifest, downloaded.manifest);
    if (marketplaceEntry) this.assertMarketplaceDownload(marketplaceEntry, downloaded.manifest, downloaded.checksums);
    return this.replaceInstalledExtension(downloaded.manifest, downloaded.manifestUrl, {
      kind: marketplaceEntry ? "marketplace" : "github",
      verified: Boolean(marketplaceEntry),
      repositoryUrl: downloaded.repositoryUrl,
      ...(downloaded.releaseTag ? { releaseTag: downloaded.releaseTag } : {}),
      ...(marketplaceEntry?.publisher === "edgeever" ? { publisher: "edgeever" } : {}),
    }, downloaded.pluginPackage);
  }

  async installMarketplaceEntry(entry: MarketplaceEntry, confirmedManifest?: ExtensionManifest) {
    if (entry.distribution.type === "github") {
      return this.installFromGithubRepository(entry.distribution.repositoryUrl, entry, confirmedManifest);
    }
    return this.installFromManifestUrl(entry.distribution.manifestUrl, entry, confirmedManifest);
  }

  async installFromManifestUrl(input: string, marketplaceEntry?: MarketplaceEntry, confirmedManifest?: ExtensionManifest) {
    const manifestUrl = new URL(input, window.location.href);
    if (!["http:", "https:"].includes(manifestUrl.protocol)) {
      throw new Error("Extension manifests must use an HTTP or HTTPS URL.");
    }
    const response = await window.fetch(manifestUrl.href, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
    const manifestText = await response.text();
    const manifest = parseExtensionManifest(JSON.parse(manifestText) as unknown);
    assertConfirmedManifest(confirmedManifest, manifest);
    let pluginPackage: CachedPluginPackage | null = null;
    if (manifest.type === "plugin") {
      const entryUrl = resolveManifestEntry(manifestUrl.href, manifest.entry);
      const entryResponse = await window.fetch(entryUrl, { cache: "no-store", credentials: "omit" });
      if (!entryResponse.ok) throw new Error(`Plugin entry request failed with HTTP ${entryResponse.status}.`);
      const mainJs = await entryResponse.text();
      if (new TextEncoder().encode(mainJs).byteLength > 5 * 1024 * 1024) throw new Error("Plugin main.js exceeds the 5 MB limit.");
      const stylesUrl = new URL("./styles.css", manifestUrl.href);
      const stylesResponse = await window.fetch(stylesUrl, { cache: "no-store", credentials: "omit" });
      const stylesCss = stylesResponse.ok && stylesResponse.headers.get("content-type")?.toLocaleLowerCase().includes("text/css")
        ? await stylesResponse.text()
        : null;
      if (stylesCss && new TextEncoder().encode(stylesCss).byteLength > 1024 * 1024) throw new Error("Plugin styles.css exceeds the 1 MB limit.");
      pluginPackage = {
        pluginId: manifest.id,
        version: manifest.version,
        mainJs,
        stylesCss,
        checksums: {
          manifestJson: await sha256Hex(manifestText),
          mainJs: await sha256Hex(mainJs),
          ...(stylesCss ? { stylesCss: await sha256Hex(stylesCss) } : {}),
        },
        cachedAt: new Date().toISOString(),
      };
    }
    const actualChecksums = pluginPackage?.checksums ?? { manifestJson: await sha256Hex(manifestText) };
    if (marketplaceEntry) this.assertMarketplaceDownload(marketplaceEntry, manifest, actualChecksums);
    return this.replaceInstalledExtension(manifest, manifestUrl.href, {
      kind: marketplaceEntry ? "marketplace" : "manifest",
      verified: Boolean(marketplaceEntry),
      repositoryUrl: marketplaceEntry?.repositoryUrl,
      ...(marketplaceEntry?.publisher === "edgeever" ? { publisher: "edgeever" } : {}),
    }, pluginPackage);
  }

  private async replaceInstalledExtension(
    manifest: ExtensionManifest,
    manifestUrl: string,
    source: ExtensionInstallSource,
    pluginPackage: CachedPluginPackage | null,
  ) {
    if (await isPluginIdRevoked(manifest.id)) {
      throw new Error(`Extension ${manifest.id} was revoked and can no longer be installed or updated.`);
    }
    const previous = this.extensions.find((item) => item.manifest.id === manifest.id);
    const wasActive = this.activePlugins.has(manifest.id);
    if (pluginPackage) await this.packageStorage.put(pluginPackage);
    if (wasActive) await this.deactivatePlugin(manifest.id);
    const installed = this.installManifest(manifest, manifestUrl, source);
    try {
      if (installed.enabled && installed.manifest.type === "plugin") await this.activatePlugin(installed.manifest.id);
      this.markCatalogDirty(installed.manifest.id);
      await this.pushCatalog(this.requireExtension(installed.manifest.id));
      return this.requireExtension(installed.manifest.id);
    } catch (error) {
      if (previous) {
        this.extensions = [...this.extensions.filter((item) => item.manifest.id !== previous.manifest.id), previous]
          .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
        this.persist();
        if (previous.enabled && previous.manifest.type === "plugin") {
          await this.activatePlugin(previous.manifest.id).catch(() => undefined);
        }
      }
      if (pluginPackage && previous?.manifest.version !== pluginPackage.version) {
        await this.packageStorage.remove(pluginPackage.pluginId, pluginPackage.version).catch(() => undefined);
      }
      throw error;
    }
  }

  installManifest(manifest: ExtensionManifest, manifestUrl: string, source: ExtensionInstallSource = { kind: "manifest", verified: false }) {
    const normalizedManifest = parseExtensionManifest(manifest);
    const existing = this.extensions.find((item) => item.manifest.id === normalizedManifest.id);
    const installedAt = existing?.installedAt ?? new Date().toISOString();
    const installed: InstalledExtension = {
      manifestUrl,
      manifest: normalizedManifest,
      enabled: existing?.enabled ?? false,
      installedAt,
      catalogUpdatedAt: existing?.catalogUpdatedAt ?? installedAt,
      error: null,
      source,
    };
    this.extensions = [...this.extensions.filter((item) => item.manifest.id !== normalizedManifest.id), installed]
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
    this.persist();
    return installed;
  }

  async setEnabled(extensionId: string, enabled: boolean) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type === "theme") {
      this.extensions = this.extensions.map((item) => {
        if (item.manifest.type !== "theme") return item;
        if (enabled) return { ...item, enabled: item.manifest.id === extensionId, error: item.manifest.id === extensionId ? null : item.error };
        return item.manifest.id === extensionId ? { ...item, enabled: false, error: null } : item;
      });
      if (enabled) {
        this.activeThemeId = extensionId;
        writeStorageItem(ACTIVE_THEME_STORAGE_KEY, extensionId);
      } else if (this.activeThemeId === extensionId) {
        this.activeThemeId = null;
        removeStorageItem(ACTIVE_THEME_STORAGE_KEY);
      }
      this.applyActiveTheme();
      this.persist();
      this.markCatalogDirty(extensionId);
      await this.pushCatalog(this.requireExtension(extensionId));
      return;
    }

    if (enabled) {
      this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, enabled: true, error: null } : item);
      this.persist();
      this.markCatalogDirty(extensionId);
      await this.pushCatalog(this.requireExtension(extensionId));
      await this.activatePlugin(extensionId);
      return;
    }

    await this.deactivatePlugin(extensionId);
    this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, enabled: false, error: null } : item);
    this.persist();
    this.markCatalogDirty(extensionId);
    await this.pushCatalog(this.requireExtension(extensionId));
  }

  async uninstall(extensionId: string) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type === "plugin") await this.deactivatePlugin(extensionId);
    this.extensions = this.extensions.filter((item) => item.manifest.id !== extensionId);
    if (this.activeThemeId === extensionId) {
      this.activeThemeId = null;
      removeStorageItem(ACTIVE_THEME_STORAGE_KEY);
      this.applyActiveTheme();
    }
    this.persist();
    await this.removeFromCatalog(extensionId);
    await Promise.all([
      this.packageStorage.remove(extensionId),
      this.secretStorage.clearNamespace(`${this.scope}:${extensionId}`),
    ]);
    clearStoragePrefix(`${STORAGE_PREFIX}:${this.scope}:${extensionId}:`);
    clearStoragePrefix(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:`);
  }

  async getSettingValue(extensionId: string, key: string, revealSecret = false): Promise<PluginSettingValue | null> {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type !== "plugin") throw new Error("Themes do not declare plugin settings.");
    const field = requireSettingField(extension.manifest, key);
    if (field.type === "secret") {
      if (!revealSecret) return null;
      return this.secretStorage.get(`${this.scope}:${extensionId}`, `setting:${key}`);
    }
    const stored = readStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`);
    if (stored !== null) return validateSettingValue(field, JSON.parse(stored) as PluginSettingValue);
    return field.default ?? null;
  }

  async hasSettingValue(extensionId: string, key: string) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type !== "plugin") return false;
    const field = requireSettingField(extension.manifest, key);
    if (field.type === "secret") return (await this.secretStorage.get(`${this.scope}:${extensionId}`, `setting:${key}`)) !== null;
    return readStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`) !== null;
  }

  async setSettingValue(extensionId: string, key: string, value: PluginSettingValue) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type !== "plugin") throw new Error("Themes do not declare plugin settings.");
    const field = requireSettingField(extension.manifest, key);
    const normalized = validateSettingValue(field, value);
    if (field.type === "secret") {
      await this.secretStorage.set(`${this.scope}:${extensionId}`, `setting:${key}`, String(normalized));
      this.emit("settings.changed", { key }, extensionId);
      return;
    }
    writeStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`, JSON.stringify(normalized));
    this.emit("settings.changed", { key }, extensionId);
  }

  async removeSettingValue(extensionId: string, key: string) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type !== "plugin") throw new Error("Themes do not declare plugin settings.");
    const field = requireSettingField(extension.manifest, key);
    if (field.type === "secret") {
      await this.secretStorage.remove(`${this.scope}:${extensionId}`, `setting:${key}`);
      this.emit("settings.changed", { key }, extensionId);
      return;
    }
    removeStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`);
    this.emit("settings.changed", { key }, extensionId);
  }

  async runCommand(pluginId: string, commandId: string) {
    const command = this.commands.get(`${pluginId}:${commandId}`);
    if (!command) throw new Error("Plugin command is not registered.");
    await command.run();
  }

  async mountPanel(
    pluginId: string,
    panelId: string,
    container: HTMLElement,
    options?: PluginPanelOpenOptions,
    onRequestClose?: () => void | Promise<void>,
    chromeAdapter?: PluginPanelChromeAdapter,
  ) {
    const key = `${pluginId}:${panelId}`;
    const panel = this.panels.get(key);
    if (!panel) throw new Error("Plugin panel is not registered.");
    const mounted = this.mountedPanels.get(key) ?? new Set<() => void>();
    this.mountedPanels.set(key, mounted);
    const pluginDispose = await panel.mount(container, {
      state: normalizePanelState(options?.state),
      requestClose: async () => {
        await onRequestClose?.();
      },
      shell: {
        set(chrome) {
          chromeAdapter?.set(normalizePluginPanelChrome(chrome));
        },
      },
    });
    if (this.panels.get(key) !== panel) {
      if (typeof pluginDispose === "function") pluginDispose();
      throw new Error("Plugin panel was closed while mounting.");
    }
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      mounted.delete(dispose);
      if (mounted.size === 0) this.mountedPanels.delete(key);
      if (typeof pluginDispose === "function") pluginDispose();
    };
    mounted.add(dispose);
    return dispose;
  }

  async getPanelCloseDecision(pluginId: string, panelId: string): Promise<PluginPanelCloseDecision> {
    const panel = this.panels.get(`${pluginId}:${panelId}`);
    if (!panel) return true;
    return panel.beforeClose ? panel.beforeClose() : true;
  }

  async mountEmbed(pluginId: string, type: string, container: HTMLElement, embed: PluginEmbedInstance) {
    const key = `${pluginId}:${type}`;
    const renderer = this.embeds.get(key);
    if (!renderer) throw new Error("Plugin embed renderer is not registered.");
    const mounted = this.mountedEmbeds.get(key) ?? new Set<() => void>();
    this.mountedEmbeds.set(key, mounted);
    const pluginDispose = await renderer.mount(container, embed);
    if (this.embeds.get(key) !== renderer) {
      if (typeof pluginDispose === "function") pluginDispose();
      throw new Error("Plugin embed renderer was removed while mounting.");
    }
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      mounted.delete(dispose);
      if (mounted.size === 0) this.mountedEmbeds.delete(key);
      if (typeof pluginDispose === "function") pluginDispose();
    };
    mounted.add(dispose);
    return dispose;
  }

  dispose() {
    return this.enqueueLifecycle(async () => {
    this.started = false;
    window.removeEventListener("edgeever:sync-queue-changed", this.handleSyncQueueChanged);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.repositoryEventDisposer?.();
    this.repositoryEventDisposer = null;
    for (const pluginId of new Set([...this.activePlugins.keys(), ...this.activatingPlugins.keys()])) await this.deactivatePlugin(pluginId);
    });
  }

  private start() {
    if (this.started) return;
    this.started = true;
    this.themeObserver = new MutationObserver(() => this.applyActiveTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("edgeever:sync-queue-changed", this.handleSyncQueueChanged);
    this.repositoryEventDisposer = subscribeRepositoryMutations(this.scope, this.handleRepositoryMutation);
    this.applyActiveTheme();
  }

  private readonly handleSyncQueueChanged = () => {
    this.emit("workspace.sync-queue-changed", {});
  };

  private readonly handleRepositoryMutation = (event: RepositoryMutationEvent) => {
    if (event.type === "note.created") return this.emit(event.type, { note: toPluginNote(event.note) });
    if (event.type === "note.updated") return this.emit(event.type, { note: toPluginNote(event.note) });
    if (event.type === "note.deleted") return this.emit(event.type, { noteId: event.noteId });
    if (event.type === "tag.changed") return this.emit(event.type, {
      ...(event.previousName ? { previousName: event.previousName } : {}),
      ...(event.name ? { name: event.name } : {}),
      ...(event.deleted ? { deleted: true } : {}),
    });
    if (event.type === "template.created") return this.emit(event.type, { template: toPluginTemplate(event.template) });
    if (event.type === "template.updated") return this.emit(event.type, { template: toPluginTemplate(event.template) });
    if (event.type === "template.deleted") return this.emit(event.type, { templateId: event.templateId });
    if (event.type === "resource.created") return this.emit(event.type, { resource: toPluginResource(event.resource) });
    if (event.type === "resource.updated") return this.emit(event.type, { resource: toPluginResource(event.resource) });
    if (event.type === "resource.deleted") return this.emit(event.type, { resourceId: event.resourceId });
    this.emit("workspace.synced", { bootstrapped: event.bootstrapped, changed: event.changed });
  };

  private requireExtension(extensionId: string) {
    const extension = this.extensions.find((item) => item.manifest.id === extensionId);
    if (!extension) throw new Error("Extension is not installed.");
    return extension;
  }

  private activatePlugin(pluginId: string) {
    const current = this.activatingPlugins.get(pluginId);
    if (current) return current;
    const pending = this.activatePluginOnce(pluginId).finally(() => { this.activatingPlugins.delete(pluginId); });
    this.activatingPlugins.set(pluginId, pending);
    return pending;
  }

  private async activatePluginOnce(pluginId: string) {
    if (this.activePlugins.has(pluginId)) return;
    const extension = this.requireExtension(pluginId);
    if (extension.manifest.type !== "plugin") return;

    const disposers: Array<() => void> = [];
    try {
      const platform = window.edgeeverDesktop?.isAvailable ? "desktop" : "web";
      if (extension.manifest.platforms?.length && !extension.manifest.platforms.includes(platform)) {
        throw new Error(`${extension.manifest.name} does not support the ${platform} platform.`);
      }
      const cachedPackage = await this.packageStorage.get(extension.manifest.id, extension.manifest.version).catch(() => null);
      let module: { default?: EdgeEverPlugin | { default?: EdgeEverPlugin } };
      if (cachedPackage) {
        const entryUrl = URL.createObjectURL(new Blob([cachedPackage.mainJs], { type: "text/javascript" }));
        try {
          module = await import(/* @vite-ignore */ entryUrl) as { default?: EdgeEverPlugin | { default?: EdgeEverPlugin } };
        } finally {
          URL.revokeObjectURL(entryUrl);
        }
        if (cachedPackage.stylesCss) {
          const style = document.createElement("style");
          style.dataset.edgeeverPluginStyle = extension.manifest.id;
          style.textContent = cachedPackage.stylesCss;
          document.head.appendChild(style);
          disposers.push(() => style.remove());
        }
      } else {
        const entryUrl = resolveManifestEntry(extension.manifestUrl, extension.manifest.entry);
        module = await import(/* @vite-ignore */ entryUrl) as { default?: EdgeEverPlugin | { default?: EdgeEverPlugin } };
      }
      const candidate = module.default;
      // Some development loaders wrap ESM defaults once more. Accept that
      // interop shape while keeping the public contract a default export.
      const unwrapped: unknown = typeof candidate === "object" && candidate !== null && "default" in candidate ? candidate.default : candidate;
      if (typeof unwrapped !== "object" || unwrapped === null || typeof (unwrapped as { activate?: unknown }).activate !== "function") {
        throw new Error("Plugin entry must default-export an object with activate(context).");
      }
      const plugin = unwrapped as EdgeEverPlugin;
      const context = this.createContext(extension.manifest, disposers);
      const deactivate = await plugin.activate(context);
      if (typeof deactivate === "function" && !disposers.includes(deactivate)) disposers.push(deactivate);
      this.activePlugins.set(pluginId, { plugin, disposers });
      this.setExtensionError(pluginId, null);
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      const message = getErrorMessage(error);
      this.extensions = this.extensions.map((item) => item.manifest.id === pluginId ? { ...item, enabled: false, error: message } : item);
      this.persist();
      throw error;
    }
  }

  private async deactivatePlugin(pluginId: string) {
    await this.activatingPlugins.get(pluginId)?.catch(() => undefined);
    const active = this.activePlugins.get(pluginId);
    if (!active) return;
    this.activePlugins.delete(pluginId);
    for (const dispose of active.disposers.reverse()) {
      try { dispose(); } catch { /* A broken disposer must not strand the plugin. */ }
    }
    try { await active.plugin.deactivate?.(); } catch { /* Cleanup must continue after a broken deactivate hook. */ }
    for (const key of Array.from(this.commands.keys())) {
      if (key.startsWith(`${pluginId}:`)) this.commands.delete(key);
    }
    for (const key of Array.from(this.panels.keys())) {
      if (key.startsWith(`${pluginId}:`)) this.panels.delete(key);
    }
    for (const key of Array.from(this.embeds.keys())) {
      if (key.startsWith(`${pluginId}:`)) this.embeds.delete(key);
    }
    for (const [key, disposers] of Array.from(this.mountedPanels)) {
      if (!key.startsWith(`${pluginId}:`)) continue;
      for (const dispose of Array.from(disposers)) {
        try { dispose(); } catch { /* Panel cleanup must not strand the plugin. */ }
      }
    }
    for (const [key, embedDisposers] of Array.from(this.mountedEmbeds)) {
      if (!key.startsWith(`${pluginId}:`)) continue;
      for (const dispose of Array.from(embedDisposers)) {
        try { dispose(); } catch { /* Embed cleanup must not strand the plugin. */ }
      }
    }
    this.refreshSnapshot();
  }

  private readonly noteWrites = new Map<string, Promise<unknown>>();
  private async withNoteWrite<T>(noteId: string, write: () => Promise<T>): Promise<T> {
    const previous = this.noteWrites.get(noteId) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(write);
    this.noteWrites.set(noteId, pending);
    try {
      return await pending;
    } finally {
      if (this.noteWrites.get(noteId) === pending) this.noteWrites.delete(noteId);
    }
  }

  private createContext(manifest: PluginManifest, disposers: Array<() => void>): PluginContext {
    const storagePrefix = `${STORAGE_PREFIX}:${this.scope}:${manifest.id}:`;
    const secretNamespace = `${this.scope}:${manifest.id}`;
    const lifetime = new AbortController();
    disposers.push(() => lifetime.abort());
    const assertSaved = (noteId: string) => {
      const active = this.editorAdapter?.getDocument();
      if (active?.noteId === noteId && active.hasUnsavedChanges) throw structuredApiError("NOTE_CONFLICT", "Save the active editor's changes before editing from a plugin.");
    };
    const assertEditorMarkdown = async () => {
      const adapter = this.editorAdapter;
      const document = adapter?.getDocument();
      if (!document) throw new Error("No note editor is currently active.");
      assertPluginMarkdownNote({ contentMarkdown: document.contentMarkdown });
      if (document.noteId) assertPluginMarkdownNote((await this.repository.getMemo(document.noteId)).memo);
      const latest = this.editorAdapter?.getDocument();
      if (adapter !== this.editorAdapter || latest?.noteId !== document.noteId || latest?.contentMarkdown !== document.contentMarkdown) {
        throw structuredApiError("NOTE_CONFLICT", "The active editor changed while the plugin was preparing an edit.");
      }
    };
    const persistStructured = async (current: MemoDetail, contentMarkdown: string, contentJson = markdownToDoc(contentMarkdown)) => {
      assertSaved(current.id);
      const latest = (await this.repository.getMemo(current.id)).memo;
      if (await structuredEditToken(latest) !== await structuredEditToken(current)) throw structuredApiError("NOTE_CONFLICT", "The note changed while the batch was being validated. Read it again.");
      assertSaved(current.id);
      if (contentMarkdown === current.contentMarkdown) return current;
      const updated = (await this.repository.updateMemo(current, {
        expectedRevision: current.revision, expectedContentHash: current.contentHash,
        editSessionId: `plugin:${manifest.id}`, title: current.title ?? "", tags: current.tags,
        contentMarkdown, contentJson,
      }, { guardLocalSnapshot: true })).memo;
      await this.onWorkspaceChanged?.();
      return updated;
    };
    return {
      pluginId: manifest.id,
      ai: {
        status: async () => {
          assertPermission(manifest, 'ai:generate'); lifetime.signal.throwIfAborted();
          if (!this.aiAdapter) return { configured: false };
          const result = await this.aiAdapter.status(); lifetime.signal.throwIfAborted(); return result;
        },
        generate: async input => {
          assertPermission(manifest, 'ai:generate'); lifetime.signal.throwIfAborted();
          if (!this.aiAdapter) throw new Error('AI generation is unavailable in this host.');
          const signal = AbortSignal.any([lifetime.signal, ...(input.signal ? [input.signal] : [])]);
          const result = await this.aiAdapter.generate({ ...input, signal }); signal.throwIfAborted(); return result;
        },
        transcribeResource: async (noteId, resourceId) => {
          assertPermission(manifest, 'ai:generate');
          assertPermission(manifest, 'resources:read');
          lifetime.signal.throwIfAborted();
          const { transcribeNoteResource } = await import("@/lib/transcribe-note-resource");
          const result = await transcribeNoteResource(noteId, resourceId, lifetime.signal);
          lifetime.signal.throwIfAborted();
          return result;
        },
        transcribeMedia: async (media, options) => {
          assertPermission(manifest, 'ai:generate');
          lifetime.signal.throwIfAborted();
          const signal = AbortSignal.any([lifetime.signal, ...(options?.signal ? [options.signal] : [])]);
          const { transcribeMediaBlob } = await import("@/lib/transcribe-note-resource");
          const result = await transcribeMediaBlob(media, signal);
          signal.throwIfAborted();
          return result;
        },
      },
      notes: {
        query: async (input = {}) => {
          assertPermission(manifest, "notes:read");
          const result = await this.repository.listMemos({
            notebookId: input.notebookId,
            includeTotal: true,
            q: input.text,
            sort: input.sort,
            limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
            offset: Math.max(input.offset ?? 0, 0),
          });
          const notes = result.memos
            .filter((note) => !input.tags?.length || input.tags.every((tag) => note.tags.includes(tag)))
            .map(toPluginNoteSummary);
          const offset = Math.max(input.offset ?? 0, 0);
          if (result.totalCount === undefined) throw new Error("note_query_total_missing");
          return { notes, totalCount: result.totalCount, nextOffset: result.nextCursor ? offset + result.memos.length : null };
        },
        queryContent: async (input = {}) => {
          assertPermission(manifest, "notes:read");
          const result = await this.repository.listMemos({
            notebookId: input.notebookId,
            includeTotal: true,
            q: input.text,
            sort: input.sort,
            limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
            offset: Math.max(input.offset ?? 0, 0),
          });
          const summaries = result.memos.filter(
            (note) => !input.tags?.length || input.tags.every((tag) => note.tags.includes(tag)),
          );
          const notes = await Promise.all(summaries.map(async (note) =>
            toPluginNote((await this.repository.getMemo(note.id)).memo)));
          const offset = Math.max(input.offset ?? 0, 0);
          if (result.totalCount === undefined) throw new Error("note_query_total_missing");
          return { notes, totalCount: result.totalCount, nextOffset: result.nextCursor ? offset + result.memos.length : null };
        },
        get: async (noteId) => {
          assertPermission(manifest, "notes:read");
          return toPluginNote((await this.repository.getMemo(noteId)).memo);
        },
        editMarkdown: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:read");
          assertPermission(manifest, "notes:write");
          if (
            !input
            || !Number.isSafeInteger(input.expectedRevision)
            || input.expectedRevision < 0
            || typeof input.expectedContentHash !== "string"
            || !input.expectedContentHash.trim()
          ) {
            throw createPluginApiError("INVALID_MARKDOWN_EDIT", "A valid expected revision and content hash are required.");
          }
          const current = (await this.repository.getMemo(noteId)).memo;
          if (current.revision !== input.expectedRevision || current.contentHash !== input.expectedContentHash) {
            throw createPluginApiError("NOTE_CONFLICT", "The note changed after the plugin read it. Reload the note before editing.");
          }
          assertPluginMarkdownNote(current);
          const activeDocument = this.editorAdapter?.getDocument();
          if (activeDocument?.noteId === noteId && activeDocument.hasUnsavedChanges) {
            throw createPluginApiError("NOTE_CONFLICT", "The note has unsaved editor changes. Save them before editing from a plugin.");
          }
          const contentMarkdown = applyPluginMarkdownEdits(current.contentMarkdown, input.edits);
          assertPluginMarkdownNote({ contentMarkdown });
          if (contentMarkdown === current.contentMarkdown) return toPluginNote(current);
          const updated = (await this.repository.updateMemo(current, {
            expectedRevision: input.expectedRevision,
            expectedContentHash: input.expectedContentHash,
            editSessionId: `plugin:${manifest.id}`,
            title: current.title ?? "",
            contentJson: markdownToDoc(contentMarkdown),
            contentMarkdown,
            tags: current.tags,
          }, { guardLocalSnapshot: true })).memo;
          const note = toPluginNote(updated);
          await this.onWorkspaceChanged?.();
          return note;
        }),
        create: async (input) => {
          assertPermission(manifest, "notes:write");
          assertPluginMarkdownNote({ contentMarkdown: input.contentMarkdown });
          const note = toPluginNote((await this.repository.createMemo(input)).memo);
          await this.onWorkspaceChanged?.();
          return note;
        },
        update: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:write");
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          assertSaved(noteId);
          if (input.contentMarkdown !== undefined) {
            assertPluginMarkdownNote(current);
            assertPluginMarkdownNote({ contentMarkdown: input.contentMarkdown });
          }
          const contentMarkdown = input.contentMarkdown ?? current.contentMarkdown;
          const updated = (await this.repository.updateMemo(current, {
            expectedRevision: current.revision,
            expectedContentHash: current.contentHash,
            editSessionId: `plugin:${manifest.id}`,
            title: input.title ?? current.title ?? "",
            contentJson: input.contentMarkdown === undefined ? current.contentJson : markdownToDoc(contentMarkdown),
            contentMarkdown,
            tags: input.tags ?? current.tags,
          }, { guardLocalSnapshot: true })).memo;
          const note = toPluginNote(updated);
          await this.onWorkspaceChanged?.();
          return note;
        }),
        delete: async (noteId, options) => {
          assertPermission(manifest, "notes:delete");
          await this.repository.deleteMemo(noteId, Boolean(options?.permanent));
          await this.onWorkspaceChanged?.();
        },
        move: async (noteIds, notebookId) => {
          assertPermission(manifest, "notes:write");
          const { moved } = await this.repository.moveMemos({ memoIds: noteIds, notebookId });
          await this.onWorkspaceChanged?.();
          return moved;
        },
        pin: async (noteIds, isPinned) => {
          assertPermission(manifest, "notes:write");
          const { updated } = await this.repository.pinMemos({ memoIds: noteIds, isPinned });
          await this.onWorkspaceChanged?.();
          return updated;
        },
        restore: async (noteId) => {
          assertPermission(manifest, "notes:write");
          assertPermission(manifest, "notes:read");
          const note = toPluginNote((await this.repository.restoreMemo(noteId)).memo);
          await this.onWorkspaceChanged?.();
          return note;
        },
        revisions: {
          list: async (noteId) => {
            assertPermission(manifest, "notes:read");
            return (await this.repository.listMemoRevisions(noteId)).revisions.map(toPluginRevision);
          },
          restore: async (noteId, revisionId) => {
            assertPermission(manifest, "notes:read");
            assertPermission(manifest, "notes:write");
            const note = toPluginNote((await this.repository.restoreMemoRevision(noteId, revisionId)).memo);
            await this.onWorkspaceChanged?.();
            return note;
          },
        },
      },
      diagrams: {
        get: async (noteId, options) => {
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          return { note: toPluginNote(current), diagram: diagramSemanticGraph(pluginDiagram(current), options?.includeLayout === true), editToken: await structuredEditToken(current) };
        },
        edit: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:read"); assertPermission(manifest, "notes:write");
          const current = (await this.repository.getMemo(noteId)).memo;
          await assertStructuredRevision(current, input); assertSaved(noteId);
          try {
            const mutation = await applyDiagramOperations({ operations: input.operations, reflow: input.reflow }, pluginDiagram(current));
            const note = input.dryRun === true ? current : await persistStructured(current, mutation.contentMarkdown);
            return { note: toPluginNote(note), diagram: diagramSemanticGraph(mutation.document, true), editToken: await structuredEditToken(note), dryRun: input.dryRun === true };
          } catch (error) { return translateStructuredError(error); }
        }),
      },
      tables: {
        get: async (noteId) => {
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          return { note: toPluginNote(current), table: pluginTable(current), editToken: await structuredEditToken(current) };
        },
        edit: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:read"); assertPermission(manifest, "notes:write");
          const current = (await this.repository.getMemo(noteId)).memo;
          await assertStructuredRevision(current, input); assertSaved(noteId);
          if (input.allowDataChanges !== undefined && typeof input.allowDataChanges !== "boolean") throw structuredApiError("INVALID_STRUCTURED_EDIT", "allowDataChanges must be a boolean.");
          try {
            // Resolve attachments once per batch through the host repository.
            let resourcesPromise: ReturnType<EdgeEverRepository["listResources"]> | undefined;
            const mutation = await applyTableOperations(pluginTable(current), input.operations, async resourceId => {
              const resources = (await (resourcesPromise ??= this.repository.listResources())).resources;
              const resource = resources.find(item => item.id === resourceId && item.memoId === noteId && item.kind === "attachment" && !item.memoDeleted);
              return resource ? { resourceId: resource.id, filename: resource.filename ?? "attachment", mimeType: resource.mimeType ?? "application/octet-stream", byteSize: resource.byteSize } : null;
            });
            if (!input.dryRun && mutation.changedCellCount > 0 && input.allowDataChanges !== true) throw structuredApiError("TABLE_DATA_CHANGES_REQUIRED", "Schema changes affect populated cells. Preview with dryRun, then set allowDataChanges=true.");
            const note = input.dryRun === true ? current : await persistStructured(current, serializeTableDocument(mutation.document), markdownToDoc(tableFallbackMarkdown(mutation.document)));
            return { note: toPluginNote(note), table: mutation.document, editToken: await structuredEditToken(note), dryRun: input.dryRun === true, changedCellCount: mutation.changedCellCount, removedAttachmentCount: mutation.removedAttachmentCount };
          } catch (error) { return translateStructuredError(error); }
        }),
      },
      posters: {
        capabilities: async () => {
          assertPermission(manifest, "notes:read");
          const capabilities = posterCapabilities();
          return { templates: capabilities.templates.map(template => template.id), platforms: capabilities.platforms.map(({ id, width, height }) => ({ id, width, height })), fonts: capabilities.fonts.map(font => font.family), editableFields: capabilities.editableFields, limits: capabilities.limits };
        },
        get: async noteId => {
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          return { note: toPluginNote(current), poster: pluginPoster(current), editToken: await structuredEditToken(current) };
        },
        edit: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:read");
          assertPermission(manifest, "notes:write");
          const current = (await this.repository.getMemo(noteId)).memo;
          await assertStructuredRevision(current, input);
          assertSaved(noteId);
          try {
            const { expectedContentHash: _hash, expectedEditToken: _token, ...edits } = input;
            const mutation = applyPosterEdits({ ...edits, memoId: noteId }, pluginPoster(current));
            const images = mutation.document.elements.filter(element => element.type === "image");
            if (images.length) {
              const owned = new Set((await this.repository.listResources()).resources
                .filter(resource => resource.memoId === noteId && resource.kind === "image" && !resource.memoDeleted).map(resource => resource.id));
              if (images.some(image => !owned.has(image.resourceId))) throw structuredApiError("INVALID_STRUCTURED_EDIT", "Poster images must be active image resources belonging to this note.");
            }
            const note = input.dryRun === true || !mutation.changed ? current : await persistStructured(current, serializePosterDocument(mutation.document));
            return { note: toPluginNote(note), poster: mutation.document, editToken: await structuredEditToken(note), dryRun: input.dryRun === true, changed: mutation.changed };
          } catch (error) { return translateStructuredError(error); }
        }),
      },
      infographics: {
        capabilities: async () => {
          assertPermission(manifest, "notes:read");
          const { infographicCapabilities } = await import("./infographic-syntax-adapter");
          return infographicCapabilities();
        },
        get: async noteId => {
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          const infographic = pluginInfographic(current);
          const { infographicSyntaxAdapter } = await import("./infographic-syntax-adapter");
          const parsed = infographicSyntaxAdapter.parse(infographic.syntax);
          return { note: toPluginNote(current), infographic, data: (parsed.options.data ?? {}) as Record<string, import("@edgeever/plugin-api").PluginJsonValue>, template: parsed.options.template ?? "", theme: parsed.options.theme, editToken: await structuredEditToken(current) };
        },
        edit: async (noteId, input) => this.withNoteWrite(noteId, async () => {
          assertPermission(manifest, "notes:read");
          assertPermission(manifest, "notes:write");
          const current = (await this.repository.getMemo(noteId)).memo;
          await assertStructuredRevision(current, input);
          assertSaved(noteId);
          try {
            const { infographicSyntaxAdapter } = await import("./infographic-syntax-adapter");
            const mutation = applyInfographicOperations(pluginInfographic(current), input.operations, infographicSyntaxAdapter);
            const note = input.dryRun === true || !mutation.changed ? current : await persistStructured(current, serializeInfographicDocument(mutation.document));
            return { note: toPluginNote(note), infographic: mutation.document, editToken: await structuredEditToken(note), dryRun: input.dryRun === true, changed: mutation.changed };
          } catch (error) { return translateStructuredError(error); }
        }),
      },
      notebooks: {
        list: async () => {
          assertPermission(manifest, "metadata:read");
          const { notebooks } = await this.repository.listNotebooks();
          return notebooks.map(toPluginNotebook);
        },
        create: async (input) => {
          assertPermission(manifest, "metadata:write");
          const notebook = toPluginNotebook((await this.repository.createNotebook(input)).notebook);
          await this.onWorkspaceChanged?.();
          return notebook;
        },
        update: async (notebookId, input) => {
          assertPermission(manifest, "metadata:write");
          assertPermission(manifest, "metadata:read");
          const notebook = toPluginNotebook((await this.repository.updateNotebook(notebookId, input)).notebook);
          await this.onWorkspaceChanged?.();
          return notebook;
        },
        delete: async (notebookId) => {
          assertPermission(manifest, "metadata:write");
          await this.repository.deleteNotebook(notebookId);
          await this.onWorkspaceChanged?.();
        },
      },
      tags: {
        list: async () => {
          assertPermission(manifest, "metadata:read");
          const { tags } = await this.repository.listTags();
          return tags.map(({ name, memoCount }) => ({ name, noteCount: memoCount }));
        },
        rename: async (name, nextName) => {
          assertPermission(manifest, "metadata:write");
          const { updated } = await this.repository.renameTag(name, nextName);
          await this.onWorkspaceChanged?.();
          return updated;
        },
        delete: async (name) => {
          assertPermission(manifest, "metadata:write");
          const { updated } = await this.repository.deleteTag(name);
          await this.onWorkspaceChanged?.();
          return updated;
        },
      },
      templates: {
        list: async () => {
          assertPermission(manifest, "templates:read");
          return (await this.repository.listTemplates()).templates.map(toPluginTemplate);
        },
        create: async (input) => {
          assertPermission(manifest, "templates:write");
          if (input.noteId) assertPermission(manifest, "notes:read");
          const template = toPluginTemplate((await this.repository.createTemplate({
            name: input.name,
            description: input.description,
            memoId: input.noteId,
            title: input.title,
            contentMarkdown: input.contentMarkdown,
            tags: input.tags,
          })).template);
          await this.onWorkspaceChanged?.();
          return template;
        },
        update: async (templateId, input) => {
          assertPermission(manifest, "templates:read");
          assertPermission(manifest, "templates:write");
          const template = toPluginTemplate((await this.repository.updateTemplate(templateId, input)).template);
          await this.onWorkspaceChanged?.();
          return template;
        },
        delete: async (templateId) => {
          assertPermission(manifest, "templates:write");
          await this.repository.deleteTemplate(templateId);
          await this.onWorkspaceChanged?.();
        },
        use: async (templateId, notebookId) => {
          assertPermission(manifest, "templates:read");
          assertPermission(manifest, "notes:write");
          const note = toPluginNote((await this.repository.useTemplate(templateId, notebookId)).memo);
          await this.onWorkspaceChanged?.();
          return note;
        },
      },
      commands: {
        register: (command) => {
          assertPermission(manifest, "ui:commands");
          if (!/^[a-z0-9][a-z0-9._-]*$/i.test(command.id)) throw new Error("Plugin command id is invalid.");
          const key = `${manifest.id}:${command.id}`;
          if (this.commands.has(key)) throw new Error(`Plugin command already exists: ${command.id}`);
          this.commands.set(key, { ...command, pluginId: manifest.id });
          this.refreshSnapshot();
          const dispose = () => {
            this.commands.delete(key);
            this.refreshSnapshot();
          };
          disposers.push(dispose);
          return dispose;
        },
      },
      schedules: {
        upsert: async (input) => {
          assertPermission(manifest, "schedules");
          if (!this.scheduleAdapter) throw new Error("Plugin schedules are only available in the EdgeEver desktop app.");
          if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.key) || input.key.length > 120) {
            throw new Error("Plugin schedule key is invalid.");
          }
          if (!this.commands.has(`${manifest.id}:${input.commandId}`)) {
            throw new Error(`Plugin command must be registered before it can be scheduled: ${input.commandId}`);
          }
          return this.scheduleAdapter.upsert(manifest.id, input);
        },
        list: async () => {
          assertPermission(manifest, "schedules");
          if (!this.scheduleAdapter) throw new Error("Plugin schedules are only available in the EdgeEver desktop app.");
          return this.scheduleAdapter.list(manifest.id);
        },
        remove: async (key) => {
          assertPermission(manifest, "schedules");
          if (!this.scheduleAdapter) throw new Error("Plugin schedules are only available in the EdgeEver desktop app.");
          if (!/^[a-z0-9][a-z0-9._-]*$/i.test(key) || key.length > 120) {
            throw new Error("Plugin schedule key is invalid.");
          }
          await this.scheduleAdapter.remove(manifest.id, key);
        },
      },
      events: {
        on: (event, listener) => {
          const permission = EVENT_PERMISSIONS[event];
          if (permission) assertPermission(manifest, permission);
          const listeners = this.eventListeners.get(event) ?? new Set();
          const entry = { pluginId: manifest.id, listener: listener as (payload: never) => void };
          listeners.add(entry);
          this.eventListeners.set(event, listeners);
          const dispose = () => listeners.delete(entry);
          disposers.push(dispose);
          return dispose;
        },
      },
      storage: {
        get: async <T>(key: string) => {
          assertPermission(manifest, "storage");
          const stored = readStorageItem(`${storagePrefix}${key}`);
          return stored === null ? null : JSON.parse(stored) as T;
        },
        set: async <T>(key: string, value: T) => {
          assertPermission(manifest, "storage");
          writeStorageItem(`${storagePrefix}${key}`, JSON.stringify(value));
        },
        remove: async (key: string) => {
          assertPermission(manifest, "storage");
          removeStorageItem(`${storagePrefix}${key}`);
        },
      },
      secrets: {
        get: async (key) => {
          assertPermission(manifest, "secrets");
          return this.secretStorage.get(secretNamespace, key);
        },
        set: async (key, value) => {
          assertPermission(manifest, "secrets");
          await this.secretStorage.set(secretNamespace, key, value);
        },
        remove: async (key) => {
          assertPermission(manifest, "secrets");
          await this.secretStorage.remove(secretNamespace, key);
        },
      },
      editor: {
        getSelection: async () => {
          assertPermission(manifest, "editor:read");
          return this.editorAdapter?.getSelection() ?? null;
        },
        getDocument: async () => {
          assertPermission(manifest, "editor:read");
          return this.editorAdapter?.getDocument() ?? null;
        },
        editMarkdown: async (edits) => {
          await assertEditorMarkdown();
          assertPermission(manifest, "editor:read");
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          const current = this.editorAdapter.getDocument();
          if (!current) throw new Error("No note editor is currently active.");
          const contentMarkdown = applyPluginMarkdownEdits(current.contentMarkdown, edits);
          assertPluginMarkdownNote({ contentMarkdown });
          if (contentMarkdown !== current.contentMarkdown) this.editorAdapter.replaceDocument(contentMarkdown);
          return { ...current, contentMarkdown, hasUnsavedChanges: contentMarkdown !== current.contentMarkdown || current.hasUnsavedChanges };
        },
        insertEmbed: async (input) => {
          await assertEditorMarkdown();
          assertPermission(manifest, "editor:write");
          assertPermission(manifest, "ui:embeds");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          const type = input?.type?.trim();
          const resourceId = input?.resourceId?.trim();
          if (!type || !/^[a-z0-9][a-z0-9._-]*$/i.test(type) || !resourceId) {
            throw new Error("Plugin embeds require a valid type and resource id.");
          }
          if (!this.embeds.has(`${manifest.id}:${type}`)) {
            throw new Error("Register the plugin embed renderer before inserting an embed.");
          }
          const data = normalizePanelState(input.data);
          const embed: PluginEmbedInstance = {
            id: `embed_${crypto.randomUUID().replace(/-/g, "")}`,
            pluginId: manifest.id,
            type,
            resourceId,
            previewResourceId: input.previewResourceId?.trim() ?? "",
            title: input.title?.trim().slice(0, 500) ?? "",
            data,
          };
          this.editorAdapter.insertEmbed(embed);
          return embed;
        },
        embeds: {
          register: (renderer) => {
            assertPermission(manifest, "ui:embeds");
            const type = renderer.type?.trim();
            if (!type || !/^[a-z0-9][a-z0-9._-]*$/i.test(type)) throw new Error("Plugin embed type is invalid.");
            const key = `${manifest.id}:${type}`;
            if (this.embeds.has(key)) throw new Error(`Plugin embed renderer already exists: ${type}`);
            this.embeds.set(key, { ...renderer, type, pluginId: manifest.id });
            this.refreshSnapshot();
            const dispose = () => {
              this.embeds.delete(key);
              for (const mountedDispose of Array.from(this.mountedEmbeds.get(key) ?? [])) mountedDispose();
              this.refreshSnapshot();
            };
            disposers.push(dispose);
            return dispose;
          },
        },
        replaceSelection: async (contentMarkdown) => {
          await assertEditorMarkdown();
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          assertPluginMarkdownNote({ contentMarkdown });
          this.editorAdapter.replaceSelection(contentMarkdown);
        },
        insertAtCursor: async (contentMarkdown) => {
          await assertEditorMarkdown();
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          assertPluginMarkdownNote({ contentMarkdown });
          this.editorAdapter.insertAtCursor(contentMarkdown);
        },
      },
      resources: {
        list: async (noteId) => {
          assertPermission(manifest, "resources:read");
          const { resources } = await this.repository.listResources();
          return resources.filter((resource) => !noteId || resource.memoId === noteId).map(toPluginResource);
        },
        read: async (resourceId) => {
          assertPermission(manifest, "resources:read");
          return this.repository.readResource(resourceId);
        },
        upload: async (noteId, file) => {
          assertPermission(manifest, "resources:write");
          const resource = toPluginResource((await this.repository.uploadMemoResource(noteId, file)).resource);
          await this.onWorkspaceChanged?.();
          return resource;
        },
        update: async (resourceId, input) => {
          assertPermission(manifest, "resources:read");
          assertPermission(manifest, "resources:write");
          if (!(input?.file instanceof File) || !input.expectedContentHash?.trim()) {
            throw new Error("A file and expected resource content hash are required.");
          }
          try {
            const resource = toPluginResource((await this.repository.updateResource(
              resourceId,
              input.file,
              input.expectedContentHash,
            )).resource);
            await this.onWorkspaceChanged?.();
            return resource;
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "resource_conflict") {
              throw createPluginApiError("RESOURCE_CONFLICT", "The resource changed after the plugin read it. Reload it before saving.");
            }
            throw error;
          }
        },
        rename: async (resourceId, filename) => {
          assertPermission(manifest, "resources:write");
          assertPermission(manifest, "resources:read");
          const resource = toPluginResource((await this.repository.renameResource(resourceId, filename)).resource);
          await this.onWorkspaceChanged?.();
          return resource;
        },
        delete: async (resourceId) => {
          assertPermission(manifest, "resources:write");
          await this.repository.deleteResource(resourceId);
          await this.onWorkspaceChanged?.();
        },
      },
      settings: {
        get: (key) => this.getSettingValue(manifest.id, key, true),
        set: (key, value) => this.setSettingValue(manifest.id, key, value),
        remove: (key) => this.removeSettingValue(manifest.id, key),
      },
      network: {
        fetch: async (input, init) => {
          assertPermission(manifest, "network");
          lifetime.signal.throwIfAborted();
          const url = new URL(input);
          if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error("Plugin network requests must use HTTP or HTTPS.");
          }
          const { transport = 'direct', ...requestInit } = init ?? {};
          const signal = AbortSignal.any([lifetime.signal, ...(requestInit.signal ? [requestInit.signal] : [])]);
          if (transport === 'public') {
            assertPermission(manifest, 'network:public');
            if (!this.publicNetworkAdapter) throw new Error('Public network transport is unavailable in this host.');
            const method = (requestInit.method ?? 'GET').toUpperCase();
            if (!['GET', 'HEAD'].includes(method) || requestInit.body != null || requestInit.credentials === 'include') throw new Error('Public transport supports credential-free GET/HEAD only.');
            const data = await this.publicNetworkAdapter.fetchPublic({ url: url.href, method: method as 'GET' | 'HEAD', headers: Object.fromEntries(new Headers(requestInit.headers)) }, { signal });
            signal.throwIfAborted();
            if (requestInit.redirect === 'error' && data.status >= 300 && data.status < 400) throw new Error('Public request returned a redirect.');
            const response = new Response(method === 'HEAD' || [204, 205, 304].includes(data.status) ? null : data.body, { status: data.status, statusText: data.statusText, headers: data.headers });
            Object.defineProperty(response, 'url', { value: data.url });
            return response;
          }
          if (transport !== 'direct') throw new Error('Unsupported network transport.');
          return window.fetch(url, { ...requestInit, signal });
        },
      },
      ui: {
        showNotice: (message) => {
          assertPermission(manifest, "ui:notices");
          this.onNotice?.(message);
        },
        openNote: async (noteId, options) => {
          assertPermission(manifest, "ui:navigation");
          if (!this.navigationAdapter) throw new Error("Note navigation is unavailable in this host.");
          if (options?.search !== undefined && (typeof options.search !== "string" || !options.search.trim() || options.search.length > 500)) {
            throw new Error("Note navigation search must contain between 1 and 500 characters.");
          }
          const note = (await this.repository.getMemo(noteId)).memo;
          if (note.isDeleted) throw new Error("Deleted notes cannot be opened from a plugin.");
          await this.navigationAdapter.openNote(note.id, note.notebookId, options?.search ? { search: options.search } : undefined);
        },
        panels: {
          register: (panel) => {
            assertPermission(manifest, "ui:panels");
            if (!/^[a-z0-9][a-z0-9._-]*$/i.test(panel.id)) throw new Error("Plugin panel id is invalid.");
            if (!panel.title.trim()) throw new Error("Plugin panel title is required.");
            const allowedPurposes = new Set(["workflow", "dashboard", "preview", "onboarding"]);
            if (manifest.apiVersion === PLUGIN_API_VERSION && !allowedPurposes.has(panel.purpose)) {
              throw new Error("Plugin API v2 panels require a supported business purpose; custom settings panels are not allowed.");
            }
            const key = `${manifest.id}:${panel.id}`;
            if (this.panels.has(key)) throw new Error(`Plugin panel already exists: ${panel.id}`);
            this.panels.set(key, {
              ...panel,
              presentation: panel.presentation === "fullscreen" ? "fullscreen" : "dialog",
              pluginId: manifest.id,
            });
            this.refreshSnapshot();
            const dispose = () => {
              this.panels.delete(key);
              this.refreshSnapshot();
            };
            disposers.push(dispose);
            return dispose;
          },
          open: async (panelId, options) => {
            assertPermission(manifest, "ui:panels");
            if (!this.panels.has(`${manifest.id}:${panelId}`)) throw new Error("Plugin panel is not registered.");
            if (!this.panelAdapter) throw new Error("Plugin panel presentation is unavailable in this host.");
            await this.panelAdapter.openPanel(manifest.id, panelId, {
              state: normalizePanelState(options?.state),
            });
          },
        },
      },
    };
  }

  private assertMarketplaceDownload(
    entry: MarketplaceEntry,
    manifest: ExtensionManifest,
    actualChecksums: Partial<CachedPluginPackage["checksums"]>
  ) {
    if (manifest.id !== entry.id) throw new Error("Marketplace plugin id does not match the downloaded manifest.");
    if (manifest.version !== entry.verification.version) throw new Error("Downloaded version does not match the marketplace verified version.");
    if (manifest.type === "plugin" && manifest.apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(`Marketplace plugins must use plugin API v${PLUGIN_API_VERSION}.`);
    }
    if (entry.publisher === "edgeever") {
      if (!entry.verification.checksums?.manifestJson) throw new Error("Official extensions must pin the manifest checksum.");
      if (manifest.type === "plugin" && !entry.verification.checksums.mainJs) {
        throw new Error("Official plugins must pin the main.js checksum.");
      }
      if (actualChecksums.stylesCss && !entry.verification.checksums.stylesCss) {
        throw new Error("Official plugins must pin the styles.css checksum when styles are distributed.");
      }
    }
    for (const [name, expected] of Object.entries(entry.verification.checksums ?? {})) {
      const actual = actualChecksums[name as keyof CachedPluginPackage["checksums"]];
      if (!actual || actual.toLocaleLowerCase() !== expected) throw new Error(`${name} does not match the marketplace verified checksum.`);
    }
  }

  private emit<K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K], targetPluginId?: string) {
    for (const entry of this.eventListeners.get(event) ?? []) {
      if (targetPluginId && entry.pluginId !== targetPluginId) continue;
      try {
        const result = (entry.listener as (value: never) => unknown)(payload as never);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((error) => console.error(`Plugin event listener failed for ${event}`, error));
        }
      } catch (error) {
        console.error(`Plugin event listener failed for ${event}`, error);
      }
    }
  }

  private applyActiveTheme() {
    const root = document.documentElement;
    for (const cssVariable of Object.values(THEME_TOKEN_CSS_VARIABLES)) root.style.removeProperty(cssVariable);
    root.removeAttribute("data-edgeever-extension-theme");
    if (!this.activeThemeId) return;
    const extension = this.extensions.find((item) => item.enabled && item.manifest.id === this.activeThemeId);
    if (!extension || extension.manifest.type !== "theme") return;
    const theme = extension.manifest as ThemeManifest;
    const tokens: ThemeTokens = root.classList.contains("dark") && theme.dark ? theme.dark : theme.light;
    for (const [token, value] of Object.entries(tokens)) {
      root.style.setProperty(THEME_TOKEN_CSS_VARIABLES[token as ThemeTokenName], value);
    }
    root.dataset.edgeeverExtensionTheme = theme.id;
  }

  private setExtensionError(extensionId: string, error: string | null) {
    this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, error } : item);
    this.persist();
  }

  private markCatalogDirty(extensionId: string) {
    if (this.catalogSyncSuspended > 0) return;
    const now = new Date().toISOString();
    this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, catalogUpdatedAt: now } : item);
    this.persist();
  }

  private patchCatalogUpdatedAt(extensionId: string, catalogUpdatedAt: string) {
    if (!this.extensions.some((item) => item.manifest.id === extensionId)) return;
    this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, catalogUpdatedAt } : item);
    this.persist();
  }

  private async pushCatalog(extension: InstalledExtension, options?: { ignoreSuspend?: boolean }) {
    if (!this.catalogAdapter) return;
    if (this.catalogSyncSuspended > 0 && !options?.ignoreSuspend) return;
    try {
      const remote = await this.catalogAdapter.upsert(extension.manifest.id, toWorkspaceExtensionUpsert(extension));
      this.patchCatalogUpdatedAt(extension.manifest.id, remote.updatedAt);
    } catch (error) {
      console.error("Workspace extension catalog sync failed.", error);
    }
  }

  private async removeFromCatalog(extensionId: string) {
    if (!this.catalogAdapter || this.catalogSyncSuspended > 0) return;
    try {
      await this.catalogAdapter.remove(extensionId);
    } catch (error) {
      console.error("Workspace extension catalog sync failed.", error);
    }
  }

  private persist() {
    writeStorageItem(INSTALLED_EXTENSIONS_STORAGE_KEY, JSON.stringify(this.extensions));
    this.refreshSnapshot();
  }

  private refreshSnapshot() {
    this.snapshot = {
      catalogErrors: this.catalogErrors.map((item) => ({ ...item })),
      extensions: this.extensions.map((item) => ({ ...item, manifest: { ...item.manifest } })),
      commands: [...this.commands.values()].map(({ pluginId, id, title, listed, menu }) => ({
        pluginId,
        id,
        title,
        listed: listed === false ? false : undefined,
        menu: menu === false ? false : undefined,
      })),
      panels: [...this.panels.values()].map(({ pluginId, id, title, purpose, presentation }) => ({
        pluginId,
        id,
        title,
        purpose,
        presentation: presentation === "fullscreen" ? "fullscreen" : "dialog",
      })),
      embeds: [...this.embeds.values()].map(({ pluginId, type }) => ({ pluginId, type })),
      activeThemeId: this.activeThemeId,
    };
    for (const listener of this.listeners) listener();
  }
}
