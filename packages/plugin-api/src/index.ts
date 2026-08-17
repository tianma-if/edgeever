export const PLUGIN_API_VERSION = "1" as const;
export const THEME_API_VERSION = "1" as const;

export const PLUGIN_PERMISSIONS = [
  "notes:read",
  "notes:write",
  "notes:delete",
  "metadata:read",
  "metadata:write",
  "network",
  "storage",
  "secrets",
  "editor:read",
  "editor:write",
  "ui:commands",
  "ui:notices",
  "ui:panels",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];
export type ExtensionPlatform = "web" | "desktop" | "android" | "ios";

export interface PluginManifest {
  type: "plugin";
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  description?: string;
  author?: string;
  entry: string;
  platforms?: ExtensionPlatform[];
  permissions: PluginPermission[];
  networkHosts?: string[];
}

export const THEME_TOKEN_NAMES = [
  "color.background",
  "color.surface",
  "color.surfaceMuted",
  "color.text",
  "color.textMuted",
  "color.border",
  "color.accent",
  "color.accentForeground",
  "color.success",
  "color.warning",
  "color.danger",
  "font.body",
  "font.mono",
  "font.size",
  "lineHeight.body",
  "radius.medium",
  "density.scale",
  "editor.contentWidth",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;

export interface ThemeManifest {
  type: "theme";
  id: string;
  name: string;
  version: string;
  themeApiVersion: typeof THEME_API_VERSION;
  description?: string;
  author?: string;
  modes: Array<"light" | "dark">;
  light: ThemeTokens;
  dark?: ThemeTokens;
}

export type ExtensionManifest = PluginManifest | ThemeManifest;

export const MARKETPLACE_REGISTRY_VERSION = "1" as const;

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  repositoryUrl: string;
  distribution:
    | { type: "github"; repositoryUrl: string }
    | { type: "manifest"; manifestUrl: string };
  verification: {
    version: string;
    checksums?: {
      manifestJson?: string;
      mainJs?: string;
      stylesCss?: string;
    };
  };
}

export interface MarketplaceRegistry {
  registryVersion: typeof MARKETPLACE_REGISTRY_VERSION;
  updatedAt: string;
  entries: MarketplaceEntry[];
}

export interface PluginNoteSummary {
  id: string;
  notebookId: string;
  title: string | null;
  excerpt: string;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PluginNote extends PluginNoteSummary {
  contentMarkdown: string;
  contentText: string;
}

export interface PluginNoteQuery {
  notebookId?: string;
  text?: string;
  tags?: string[];
  sort?: "updated-desc" | "created-desc" | "title-asc";
  limit?: number;
  offset?: number;
}

export interface PluginNoteCreateInput {
  notebookId: string;
  title?: string;
  contentMarkdown?: string;
  tags?: string[];
}

export interface PluginNoteUpdateInput {
  title?: string;
  contentMarkdown?: string;
  tags?: string[];
}

export interface PluginNoteQueryResult {
  notes: PluginNoteSummary[];
  totalCount: number;
  nextOffset: number | null;
}

export interface PluginNotebook {
  id: string;
  parentId: string | null;
  name: string;
  memoCount: number;
}

export interface PluginTag {
  name: string;
  noteCount: number;
}

export type PluginEventMap = {
  "note.created": { note: PluginNote };
  "note.updated": { note: PluginNote };
  "note.deleted": { noteId: string };
  "tag.changed": { previousName?: string; name?: string; deleted?: boolean };
  "workspace.sync-queue-changed": Record<string, never>;
};

export interface PluginCommand {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

export interface PluginEditorSelection {
  noteId: string;
  from: number;
  to: number;
  empty: boolean;
  text: string;
  contentMarkdown: string;
}

export interface PluginPanel {
  id: string;
  title: string;
  mount(container: HTMLElement): void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginContext {
  pluginId: string;
  notes: {
    query(input?: PluginNoteQuery): Promise<PluginNoteQueryResult>;
    get(noteId: string): Promise<PluginNote>;
    create(input: PluginNoteCreateInput): Promise<PluginNote>;
    update(noteId: string, input: PluginNoteUpdateInput): Promise<PluginNote>;
    delete(noteId: string, options?: { permanent?: boolean }): Promise<void>;
  };
  notebooks: {
    list(): Promise<PluginNotebook[]>;
  };
  tags: {
    list(): Promise<PluginTag[]>;
    rename(name: string, nextName: string): Promise<number>;
    delete(name: string): Promise<number>;
  };
  commands: {
    register(command: PluginCommand): () => void;
  };
  events: {
    on<K extends keyof PluginEventMap>(event: K, listener: (payload: PluginEventMap[K]) => void): () => void;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  editor: {
    getSelection(): Promise<PluginEditorSelection | null>;
    replaceSelection(contentMarkdown: string): Promise<void>;
    insertAtCursor(contentMarkdown: string): Promise<void>;
  };
  network: {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
  ui: {
    showNotice(message: string): void;
    panels: {
      register(panel: PluginPanel): () => void;
    };
  };
}

export interface EdgeEverPlugin {
  activate(context: PluginContext): void | (() => void) | Promise<void | (() => void)>;
  deactivate?(): void | Promise<void>;
}

export const definePlugin = <T extends EdgeEverPlugin>(plugin: T): T => plugin;
export const defineTheme = <T extends ThemeManifest>(theme: T): T => theme;

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const COLOR_THEME_TOKENS = new Set<ThemeTokenName>([
  "color.background", "color.surface", "color.surfaceMuted", "color.text", "color.textMuted",
  "color.border", "color.accent", "color.accentForeground", "color.success", "color.warning", "color.danger",
]);
const FONT_THEME_TOKENS = new Set<ThemeTokenName>(["font.body", "font.mono"]);
const LENGTH_THEME_TOKENS = new Set<ThemeTokenName>(["font.size", "radius.medium", "editor.contentWidth"]);

const validateThemeToken = (key: ThemeTokenName, value: string) => {
  if (COLOR_THEME_TOKENS.has(key) && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
    throw new Error(`Theme color token ${key} must use #RRGGBB or #RRGGBBAA.`);
  }
  if (FONT_THEME_TOKENS.has(key) && (!/^[a-z0-9 ,_'"-]+$/i.test(value) || value.length > 200)) {
    throw new Error(`Theme font token ${key} contains unsupported characters.`);
  }
  if (LENGTH_THEME_TOKENS.has(key) && !/^\d+(?:\.\d+)?(?:px|rem|em|%)$/.test(value)) {
    throw new Error(`Theme length token ${key} must use px, rem, em, or %.`);
  }
  if (key === "lineHeight.body" && !/^\d+(?:\.\d+)?(?:px|rem|em|%)?$/.test(value)) {
    throw new Error("Theme lineHeight.body must be a number or a supported CSS length.");
  }
  if (key === "density.scale" && !/^(?:0\.[5-9]\d?|1(?:\.\d{1,2})?)$/.test(value)) {
    throw new Error("Theme density.scale must be between 0.5 and 1.99.");
  }
};

const assertCommonManifest = (value: Record<string, unknown>) => {
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw new Error("Extension id must be a reverse-domain style identifier using lowercase letters, numbers, dots, dashes, or underscores.");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Extension name is required.");
  }
  if (typeof value.version !== "string" || !VERSION_PATTERN.test(value.version)) {
    throw new Error("Extension version must use SemVer.");
  }
};

const normalizeThemeTokens = (value: unknown): ThemeTokens => {
  if (!isRecord(value)) throw new Error("Theme tokens must be an object.");
  const allowed = new Set<string>(THEME_TOKEN_NAMES);
  const tokens: ThemeTokens = {};
  for (const [key, tokenValue] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error(`Unsupported theme token: ${key}`);
    if (typeof tokenValue !== "string" || !tokenValue.trim()) throw new Error(`Theme token ${key} must be a non-empty string.`);
    const normalizedValue = tokenValue.trim();
    validateThemeToken(key as ThemeTokenName, normalizedValue);
    tokens[key as ThemeTokenName] = normalizedValue;
  }
  return tokens;
};

export const parseExtensionManifest = (value: unknown): ExtensionManifest => {
  if (!isRecord(value)) throw new Error("Extension manifest must be an object.");
  assertCommonManifest(value);

  if (value.type === "plugin") {
    if (value.apiVersion !== PLUGIN_API_VERSION) throw new Error(`Unsupported plugin API version: ${String(value.apiVersion)}`);
    if (typeof value.entry !== "string" || !value.entry.trim()) throw new Error("Plugin entry is required.");
    if (!Array.isArray(value.permissions)) throw new Error("Plugin permissions must be an array.");
    const allowedPermissions = new Set<string>(PLUGIN_PERMISSIONS);
    const permissions = [...new Set(value.permissions.map(String))];
    const unsupported = permissions.find((permission) => !allowedPermissions.has(permission));
    if (unsupported) throw new Error(`Unsupported plugin permission: ${unsupported}`);
    const networkHosts = value.networkHosts === undefined
      ? undefined
      : Array.isArray(value.networkHosts)
        ? value.networkHosts.map(String)
        : (() => { throw new Error("networkHosts must be an array."); })();
    if (networkHosts?.some((host) => !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) {
      throw new Error("networkHosts entries must be hostnames without a scheme, port, or path.");
    }
    if (permissions.includes("network") && !networkHosts?.length) {
      throw new Error("Plugins requesting network permission must declare networkHosts.");
    }
    const platforms = value.platforms === undefined
      ? undefined
      : Array.isArray(value.platforms) && value.platforms.every((platform) => ["web", "desktop", "android", "ios"].includes(String(platform)))
        ? [...new Set(value.platforms.map(String))] as ExtensionPlatform[]
        : (() => { throw new Error("Plugin platforms contains an unsupported platform."); })();
    return { ...value, type: "plugin", permissions, networkHosts, platforms } as PluginManifest;
  }

  if (value.type === "theme") {
    if (value.themeApiVersion !== THEME_API_VERSION) throw new Error(`Unsupported theme API version: ${String(value.themeApiVersion)}`);
    if (!Array.isArray(value.modes) || value.modes.length === 0 || value.modes.some((mode) => mode !== "light" && mode !== "dark")) {
      throw new Error("Theme modes must contain light and/or dark.");
    }
    return {
      ...value,
      type: "theme",
      modes: [...new Set(value.modes)] as Array<"light" | "dark">,
      light: normalizeThemeTokens(value.light),
      dark: value.dark === undefined ? undefined : normalizeThemeTokens(value.dark),
    } as ThemeManifest;
  }

  throw new Error("Extension type must be plugin or theme.");
};

const normalizeChecksum = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return value.toLocaleLowerCase();
};
const GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i;

export const parseMarketplaceRegistry = (value: unknown): MarketplaceRegistry => {
  if (!isRecord(value) || value.registryVersion !== MARKETPLACE_REGISTRY_VERSION || !Array.isArray(value.entries)) {
    throw new Error("Unsupported marketplace registry format.");
  }
  if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new Error("Marketplace registry updatedAt must be an ISO date.");
  }
  const ids = new Set<string>();
  const entries = value.entries.map((item): MarketplaceEntry => {
    if (!isRecord(item) || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) throw new Error("Marketplace entry id is invalid.");
    if (ids.has(item.id)) throw new Error(`Duplicate marketplace entry id: ${item.id}`);
    ids.add(item.id);
    for (const field of ["name", "description", "author", "category", "repositoryUrl"] as const) {
      if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`Marketplace entry ${item.id} is missing ${field}.`);
    }
    const name = item.name as string;
    const description = item.description as string;
    const author = item.author as string;
    const category = item.category as string;
    const repositoryUrl = item.repositoryUrl as string;
    if (!GITHUB_REPOSITORY_PATTERN.test(repositoryUrl)) throw new Error(`Marketplace entry ${item.id} repositoryUrl must be a GitHub repository.`);
    if (!isRecord(item.distribution) || (item.distribution.type !== "github" && item.distribution.type !== "manifest")) {
      throw new Error(`Marketplace entry ${item.id} has an invalid distribution.`);
    }
    const distribution = item.distribution.type === "github"
      ? typeof item.distribution.repositoryUrl === "string" && GITHUB_REPOSITORY_PATTERN.test(item.distribution.repositoryUrl)
        ? { type: "github" as const, repositoryUrl: item.distribution.repositoryUrl }
        : (() => { throw new Error(`Marketplace entry ${item.id} has an invalid GitHub repository.`); })()
      : typeof item.distribution.manifestUrl === "string" && (/^https:\/\//i.test(item.distribution.manifestUrl) || item.distribution.manifestUrl.startsWith("/"))
        ? { type: "manifest" as const, manifestUrl: item.distribution.manifestUrl }
        : (() => { throw new Error(`Marketplace entry ${item.id} has an invalid manifest URL.`); })();
    if (!isRecord(item.verification) || typeof item.verification.version !== "string" || !VERSION_PATTERN.test(item.verification.version)) {
      throw new Error(`Marketplace entry ${item.id} has an invalid verified version.`);
    }
    const checksums = item.verification.checksums === undefined
      ? undefined
      : isRecord(item.verification.checksums)
        ? Object.fromEntries(Object.entries(item.verification.checksums).map(([key, checksum]) => {
            if (!["manifestJson", "mainJs", "stylesCss"].includes(key)) throw new Error(`Marketplace entry ${item.id} has an unsupported checksum.`);
            return [key, normalizeChecksum(checksum, `${item.id} ${key}`)];
          })) as MarketplaceEntry["verification"]["checksums"]
        : (() => { throw new Error(`Marketplace entry ${item.id} checksums must be an object.`); })();
    if (!checksums?.manifestJson) throw new Error(`Marketplace entry ${item.id} must pin the manifest.json checksum.`);
    return {
      id: item.id,
      name: name.trim(),
      description: description.trim(),
      author: author.trim(),
      category: category.trim(),
      repositoryUrl: repositoryUrl.trim(),
      distribution,
      verification: { version: item.verification.version, checksums },
    };
  });
  return { registryVersion: MARKETPLACE_REGISTRY_VERSION, updatedAt: value.updatedAt, entries };
};
