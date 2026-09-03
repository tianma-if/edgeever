import {
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
  type PluginPanelCloseDecision,
  type PluginPanelOpenOptions,
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
import { markdownToDoc } from "@edgeever/shared";
import type { EdgeEverRepository } from "@/lib/repository";
import { WebPluginSecretStore, type PluginSecretStorage } from "@/lib/plugins/plugin-secret-store";
import { WebPluginPackageStore, type CachedPluginPackage, type PluginPackageStorage } from "@/lib/plugins/plugin-package-store";
import { downloadGithubExtension, extensionManifestsEqual, parseGithubRepositoryUrl, sha256Hex } from "@/lib/plugins/github-plugin-distribution";
import { subscribeRepositoryMutations, type RepositoryMutationEvent } from "@/lib/repository-events";

const INSTALLED_EXTENSIONS_STORAGE_KEY = "edgeever.extensions.installed.v1";
const ACTIVE_THEME_STORAGE_KEY = "edgeever.extensions.active-theme.v1";
const STORAGE_PREFIX = "edgeever.plugin-data.v1";
const SETTINGS_STORAGE_PREFIX = "edgeever.plugin-settings.v1";
const RECENT_ACTIONS_STORAGE_PREFIX = "edgeever.extensions.recent-actions.v1";

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
  error: string | null;
  source: ExtensionInstallSource;
}

export interface ExtensionInstallSource {
  kind: "manifest" | "github" | "marketplace";
  repositoryUrl?: string;
  releaseTag?: string;
  verified: boolean;
}

export interface RegisteredPluginCommand {
  pluginId: string;
  id: string;
  title: string;
}

export interface RegisteredPluginPanel {
  pluginId: string;
  id: string;
  title: string;
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

export interface PluginPanelAdapter {
  openPanel(pluginId: string, panelId: string, options?: PluginPanelOpenOptions): void | Promise<void>;
}

export interface PluginScheduleAdapter {
  upsert(pluginId: string, input: PluginScheduleInput): Promise<PluginSchedule>;
  list(pluginId: string): Promise<PluginSchedule[]>;
  remove(pluginId: string, key: string): Promise<void>;
}

export interface PluginHostSnapshot {
  extensions: InstalledExtension[];
  commands: RegisteredPluginCommand[];
  panels: RegisteredPluginPanel[];
  embeds: RegisteredPluginEmbed[];
  recentActions: RegisteredPluginAction[];
  activeThemeId: string | null;
}

interface PluginHostOptions {
  repository: EdgeEverRepository;
  scope: string;
  onWorkspaceChanged?: () => void | Promise<void>;
  onNotice?: (message: string) => void;
  secretStorage?: PluginSecretStorage;
  packageStorage?: PluginPackageStorage;
  scheduleAdapter?: PluginScheduleAdapter;
}

interface ActivePlugin {
  plugin: EdgeEverPlugin;
  disposers: Array<() => void>;
}

const toPluginNoteSummary = (note: Awaited<ReturnType<EdgeEverRepository["listMemos"]>>["memos"][number]): PluginNoteSummary => ({
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
        return [{
          manifestUrl: candidate.manifestUrl,
          manifest: parseExtensionManifest(candidate.manifest),
          enabled: Boolean(candidate.enabled),
          installedAt: typeof candidate.installedAt === "string" ? candidate.installedAt : new Date().toISOString(),
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
  if (!manifest.permissions.includes(permission)) {
    throw new Error(`${manifest.name} has not declared the ${permission} permission.`);
  }
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

const isAllowedNetworkHost = (hostname: string, allowedHosts: string[]) =>
  allowedHosts.some((allowedHost) => {
    const normalized = allowedHost.trim().toLocaleLowerCase();
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
    }
    return hostname === normalized;
  });

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
  private readonly repository: EdgeEverRepository;
  private readonly scope: string;
  private readonly onWorkspaceChanged?: () => void | Promise<void>;
  private readonly onNotice?: (message: string) => void;
  private readonly secretStorage: PluginSecretStorage;
  private readonly packageStorage: PluginPackageStorage;
  private readonly scheduleAdapter?: PluginScheduleAdapter;
  private readonly listeners = new Set<() => void>();
  private readonly activePlugins = new Map<string, ActivePlugin>();
  private readonly commands = new Map<string, PluginCommand & { pluginId: string }>();
  private readonly panels = new Map<string, PluginPanel & { pluginId: string }>();
  private readonly mountedPanels = new Map<string, Set<() => void>>();
  private readonly embeds = new Map<string, PluginEmbedRenderer & { pluginId: string }>();
  private readonly mountedEmbeds = new Map<string, Set<() => void>>();
  private readonly eventListeners = new Map<keyof PluginEventMap, Set<(payload: never) => void>>();
  private extensions = readInstalledExtensions();
  private activeThemeId = readStorageItem(ACTIVE_THEME_STORAGE_KEY);
  private snapshot: PluginHostSnapshot = { extensions: [], commands: [], panels: [], embeds: [], recentActions: [], activeThemeId: null };
  private recentActions: RegisteredPluginAction[];
  private editorAdapter: PluginEditorAdapter | null = null;
  private navigationAdapter: PluginNavigationAdapter | null = null;
  private panelAdapter: PluginPanelAdapter | null = null;
  private themeObserver: MutationObserver | null = null;
  private repositoryEventDisposer: (() => void) | null = null;
  private started = false;

  constructor(options: PluginHostOptions) {
    this.repository = options.repository;
    this.scope = options.scope;
    this.onWorkspaceChanged = options.onWorkspaceChanged;
    this.onNotice = options.onNotice;
    this.secretStorage = options.secretStorage ?? new WebPluginSecretStore();
    this.packageStorage = options.packageStorage ?? new WebPluginPackageStore();
    this.scheduleAdapter = options.scheduleAdapter;
    this.recentActions = this.readRecentActions();
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

  async activateEnabled() {
    this.start();
    for (const extension of this.extensions) {
      if (!extension.enabled || extension.manifest.type !== "plugin") continue;
      await this.activatePlugin(extension.manifest.id).catch(() => undefined);
    }
    this.applyActiveTheme();
  }

  async installFromSource(input: string) {
    if (parseGithubRepositoryUrl(input)) return this.installFromGithubRepository(input);
    return this.installFromManifestUrl(input);
  }

  async installFromGithubRepository(input: string, marketplaceEntry?: MarketplaceEntry, confirmedManifest?: ExtensionManifest) {
    const downloaded = await downloadGithubExtension(input);
    assertConfirmedManifest(confirmedManifest, downloaded.manifest);
    if (marketplaceEntry) this.assertMarketplaceDownload(marketplaceEntry, downloaded.manifest, downloaded.checksums);
    return this.replaceInstalledExtension(downloaded.manifest, downloaded.manifestUrl, {
      kind: marketplaceEntry ? "marketplace" : "github",
      verified: Boolean(marketplaceEntry),
      repositoryUrl: downloaded.repositoryUrl,
      ...(downloaded.releaseTag ? { releaseTag: downloaded.releaseTag } : {}),
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
    }, pluginPackage);
  }

  private async replaceInstalledExtension(
    manifest: ExtensionManifest,
    manifestUrl: string,
    source: ExtensionInstallSource,
    pluginPackage: CachedPluginPackage | null,
  ) {
    const previous = this.extensions.find((item) => item.manifest.id === manifest.id);
    const wasActive = this.activePlugins.has(manifest.id);
    if (pluginPackage) await this.packageStorage.put(pluginPackage);
    if (wasActive) await this.deactivatePlugin(manifest.id);
    const installed = this.installManifest(manifest, manifestUrl, source);
    try {
      if (installed.enabled && installed.manifest.type === "plugin") await this.activatePlugin(installed.manifest.id);
      return installed;
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
    const installed: InstalledExtension = {
      manifestUrl,
      manifest: normalizedManifest,
      enabled: existing?.enabled ?? false,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
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
      return;
    }

    if (enabled) {
      this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, enabled: true, error: null } : item);
      this.persist();
      await this.activatePlugin(extensionId);
      return;
    }

    await this.deactivatePlugin(extensionId);
    this.extensions = this.extensions.map((item) => item.manifest.id === extensionId ? { ...item, enabled: false, error: null } : item);
    this.persist();
  }

  async uninstall(extensionId: string) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type === "plugin") await this.deactivatePlugin(extensionId);
    this.extensions = this.extensions.filter((item) => item.manifest.id !== extensionId);
    this.recentActions = this.recentActions.filter((action) => action.pluginId !== extensionId);
    this.persistRecentActions();
    if (this.activeThemeId === extensionId) {
      this.activeThemeId = null;
      removeStorageItem(ACTIVE_THEME_STORAGE_KEY);
      this.applyActiveTheme();
    }
    this.persist();
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
      return;
    }
    writeStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`, JSON.stringify(normalized));
  }

  async removeSettingValue(extensionId: string, key: string) {
    const extension = this.requireExtension(extensionId);
    if (extension.manifest.type !== "plugin") throw new Error("Themes do not declare plugin settings.");
    const field = requireSettingField(extension.manifest, key);
    if (field.type === "secret") {
      await this.secretStorage.remove(`${this.scope}:${extensionId}`, `setting:${key}`);
      return;
    }
    removeStorageItem(`${SETTINGS_STORAGE_PREFIX}:${this.scope}:${extensionId}:${key}`);
  }

  async runCommand(pluginId: string, commandId: string) {
    const command = this.commands.get(`${pluginId}:${commandId}`);
    if (!command) throw new Error("Plugin command is not registered.");
    await command.run();
    this.recordRecentAction({ pluginId, id: commandId, title: command.title, type: "command" });
  }

  async mountPanel(
    pluginId: string,
    panelId: string,
    container: HTMLElement,
    options?: PluginPanelOpenOptions,
    onRequestClose?: () => void | Promise<void>,
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
    this.recordRecentAction({ pluginId, id: panelId, title: panel.title, type: "panel" });
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

  async dispose() {
    this.started = false;
    window.removeEventListener("edgeever:sync-queue-changed", this.handleSyncQueueChanged);
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.repositoryEventDisposer?.();
    this.repositoryEventDisposer = null;
    for (const pluginId of [...this.activePlugins.keys()]) await this.deactivatePlugin(pluginId);
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

  private async activatePlugin(pluginId: string) {
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
    const active = this.activePlugins.get(pluginId);
    if (!active) return;
    this.activePlugins.delete(pluginId);
    for (const dispose of active.disposers.reverse()) {
      try { dispose(); } catch { /* A broken disposer must not strand the plugin. */ }
    }
    try { await active.plugin.deactivate?.(); } catch { /* Cleanup must continue after a broken deactivate hook. */ }
    for (const key of [...this.commands.keys()]) {
      if (key.startsWith(`${pluginId}:`)) this.commands.delete(key);
    }
    for (const key of [...this.panels.keys()]) {
      if (key.startsWith(`${pluginId}:`)) this.panels.delete(key);
    }
    for (const key of [...this.embeds.keys()]) {
      if (key.startsWith(`${pluginId}:`)) this.embeds.delete(key);
    }
    for (const [key, disposers] of [...this.mountedPanels]) {
      if (!key.startsWith(`${pluginId}:`)) continue;
      for (const dispose of [...disposers]) {
        try { dispose(); } catch { /* Panel cleanup must not strand the plugin. */ }
      }
    }
    for (const [key, embedDisposers] of [...this.mountedEmbeds]) {
      if (!key.startsWith(`${pluginId}:`)) continue;
      for (const dispose of [...embedDisposers]) {
        try { dispose(); } catch { /* Embed cleanup must not strand the plugin. */ }
      }
    }
    this.refreshSnapshot();
  }

  private createContext(manifest: PluginManifest, disposers: Array<() => void>): PluginContext {
    const storagePrefix = `${STORAGE_PREFIX}:${this.scope}:${manifest.id}:`;
    const secretNamespace = `${this.scope}:${manifest.id}`;
    return {
      pluginId: manifest.id,
      notes: {
        query: async (input = {}) => {
          assertPermission(manifest, "notes:read");
          const result = await this.repository.listMemos({
            notebookId: input.notebookId,
            q: input.text,
            sort: input.sort,
            limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
            offset: Math.max(input.offset ?? 0, 0),
          });
          const notes = result.memos
            .filter((note) => !input.tags?.length || input.tags.every((tag) => note.tags.includes(tag)))
            .map(toPluginNoteSummary);
          const offset = Math.max(input.offset ?? 0, 0);
          return { notes, totalCount: result.totalCount, nextOffset: result.nextCursor ? offset + result.memos.length : null };
        },
        queryContent: async (input = {}) => {
          assertPermission(manifest, "notes:read");
          const result = await this.repository.listMemos({
            notebookId: input.notebookId,
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
          return { notes, totalCount: result.totalCount, nextOffset: result.nextCursor ? offset + result.memos.length : null };
        },
        get: async (noteId) => {
          assertPermission(manifest, "notes:read");
          return toPluginNote((await this.repository.getMemo(noteId)).memo);
        },
        editMarkdown: async (noteId, input) => {
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
          const activeDocument = this.editorAdapter?.getDocument();
          if (activeDocument?.noteId === noteId && activeDocument.hasUnsavedChanges) {
            throw createPluginApiError("NOTE_CONFLICT", "The note has unsaved editor changes. Save them before editing from a plugin.");
          }
          const contentMarkdown = applyPluginMarkdownEdits(current.contentMarkdown, input.edits);
          if (contentMarkdown === current.contentMarkdown) return toPluginNote(current);
          const updated = (await this.repository.updateMemo(current, {
            expectedRevision: input.expectedRevision,
            expectedContentHash: input.expectedContentHash,
            editSessionId: `plugin:${manifest.id}`,
            title: current.title ?? "",
            contentJson: markdownToDoc(contentMarkdown),
            contentMarkdown,
            tags: current.tags,
          })).memo;
          const note = toPluginNote(updated);
          await this.onWorkspaceChanged?.();
          return note;
        },
        create: async (input) => {
          assertPermission(manifest, "notes:write");
          const note = toPluginNote((await this.repository.createMemo(input)).memo);
          await this.onWorkspaceChanged?.();
          return note;
        },
        update: async (noteId, input) => {
          assertPermission(manifest, "notes:write");
          assertPermission(manifest, "notes:read");
          const current = (await this.repository.getMemo(noteId)).memo;
          const contentMarkdown = input.contentMarkdown ?? current.contentMarkdown;
          const updated = (await this.repository.updateMemo(current, {
            expectedRevision: current.revision,
            expectedContentHash: current.contentHash,
            editSessionId: `plugin:${manifest.id}`,
            title: input.title ?? current.title ?? "",
            contentJson: markdownToDoc(contentMarkdown),
            contentMarkdown,
            tags: input.tags ?? current.tags,
          })).memo;
          const note = toPluginNote(updated);
          await this.onWorkspaceChanged?.();
          return note;
        },
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
          listeners.add(listener as (payload: never) => void);
          this.eventListeners.set(event, listeners);
          const dispose = () => listeners.delete(listener as (payload: never) => void);
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
          assertPermission(manifest, "editor:read");
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          const current = this.editorAdapter.getDocument();
          if (!current) throw new Error("No note editor is currently active.");
          const contentMarkdown = applyPluginMarkdownEdits(current.contentMarkdown, edits);
          if (contentMarkdown !== current.contentMarkdown) this.editorAdapter.replaceDocument(contentMarkdown);
          return { ...current, contentMarkdown, hasUnsavedChanges: contentMarkdown !== current.contentMarkdown || current.hasUnsavedChanges };
        },
        insertEmbed: async (input) => {
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
              for (const mountedDispose of [...(this.mountedEmbeds.get(key) ?? [])]) mountedDispose();
              this.refreshSnapshot();
            };
            disposers.push(dispose);
            return dispose;
          },
        },
        replaceSelection: async (contentMarkdown) => {
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
          this.editorAdapter.replaceSelection(contentMarkdown);
        },
        insertAtCursor: async (contentMarkdown) => {
          assertPermission(manifest, "editor:write");
          if (!this.editorAdapter) throw new Error("No note editor is currently active.");
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
          const url = new URL(input);
          if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
            throw new Error("Plugin network requests must use HTTPS, except for localhost development.");
          }
          if (!manifest.networkHosts?.length || !isAllowedNetworkHost(url.hostname.toLocaleLowerCase(), manifest.networkHosts)) {
            throw new Error(`${url.hostname} is not declared in this plugin's networkHosts.`);
          }
          return window.fetch(url, { ...init, credentials: "omit" });
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
    for (const [name, expected] of Object.entries(entry.verification.checksums ?? {})) {
      const actual = actualChecksums[name as keyof CachedPluginPackage["checksums"]];
      if (!actual || actual.toLocaleLowerCase() !== expected) throw new Error(`${name} does not match the marketplace verified checksum.`);
    }
  }

  private emit<K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K]) {
    for (const listener of this.eventListeners.get(event) ?? []) {
      try {
        const result = (listener as (value: never) => unknown)(payload as never);
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

  private persist() {
    writeStorageItem(INSTALLED_EXTENSIONS_STORAGE_KEY, JSON.stringify(this.extensions));
    this.refreshSnapshot();
  }

  private readRecentActions(): RegisteredPluginAction[] {
    try {
      const parsed = JSON.parse(readStorageItem(`${RECENT_ACTIONS_STORAGE_PREFIX}:${this.scope}`) ?? "[]") as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const action = item as Partial<RegisteredPluginAction>;
        if (
          typeof action.pluginId !== "string" ||
          typeof action.id !== "string" ||
          typeof action.title !== "string" ||
          (action.type !== "command" && action.type !== "panel")
        ) return [];
        return [action as RegisteredPluginAction];
      }).slice(0, 5);
    } catch {
      return [];
    }
  }

  private recordRecentAction(action: RegisteredPluginAction) {
    this.recentActions = [
      action,
      ...this.recentActions.filter((item) => item.pluginId !== action.pluginId || item.id !== action.id || item.type !== action.type),
    ].slice(0, 5);
    this.persistRecentActions();
    this.refreshSnapshot();
  }

  private persistRecentActions() {
    try {
      writeStorageItem(`${RECENT_ACTIONS_STORAGE_PREFIX}:${this.scope}`, JSON.stringify(this.recentActions));
    } catch {
      // Recent actions are a convenience and must never make a successful plugin action fail.
    }
  }

  private refreshSnapshot() {
    const registeredActions = new Map<string, RegisteredPluginAction>([
      ...[...this.commands.values()].map(({ pluginId, id, title }) => [
        `command:${pluginId}:${id}`,
        { pluginId, id, title, type: "command" as const },
      ] as const),
      ...[...this.panels.values()].map(({ pluginId, id, title }) => [
        `panel:${pluginId}:${id}`,
        { pluginId, id, title, type: "panel" as const },
      ] as const),
    ]);
    this.snapshot = {
      extensions: this.extensions.map((item) => ({ ...item, manifest: { ...item.manifest } })),
      commands: [...this.commands.values()].map(({ pluginId, id, title }) => ({ pluginId, id, title })),
      panels: [...this.panels.values()].map(({ pluginId, id, title, presentation }) => ({
        pluginId,
        id,
        title,
        presentation: presentation === "fullscreen" ? "fullscreen" : "dialog",
      })),
      embeds: [...this.embeds.values()].map(({ pluginId, type }) => ({ pluginId, type })),
      recentActions: this.recentActions.flatMap((action) => {
        const registered = registeredActions.get(`${action.type}:${action.pluginId}:${action.id}`);
        return registered ? [registered] : [];
      }),
      activeThemeId: this.activeThemeId,
    };
    for (const listener of this.listeners) listener();
  }
}
