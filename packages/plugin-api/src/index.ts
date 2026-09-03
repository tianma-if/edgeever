export const PLUGIN_API_VERSION = "1" as const;
export const THEME_API_VERSION = "1" as const;

export const PLUGIN_PERMISSIONS = [
  "notes:read",
  "notes:write",
  "notes:delete",
  "metadata:read",
  "metadata:write",
  "resources:read",
  "resources:write",
  "templates:read",
  "templates:write",
  "network",
  "storage",
  "secrets",
  "schedules",
  "editor:read",
  "editor:write",
  "ui:commands",
  "ui:navigation",
  "ui:notices",
  "ui:panels",
  "ui:embeds",
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
  settings?: PluginSettingsSchema;
}

interface PluginSettingBase {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

export type PluginSettingField =
  | (PluginSettingBase & { type: "text"; default?: string; placeholder?: string })
  | (PluginSettingBase & { type: "secret"; placeholder?: string })
  | (PluginSettingBase & { type: "number"; default?: number; min?: number; max?: number; step?: number })
  | (PluginSettingBase & { type: "boolean"; default?: boolean })
  | (PluginSettingBase & { type: "select"; default?: string; options: Array<{ value: string; label: string }> });

export interface PluginSettingsSchema {
  fields: PluginSettingField[];
}

export type PluginSettingValue = string | number | boolean;

export const PLUGIN_API_ERROR_CODES = ["NOTE_CONFLICT", "RESOURCE_CONFLICT", "INVALID_MARKDOWN_EDIT"] as const;
export type PluginApiErrorCode = (typeof PLUGIN_API_ERROR_CODES)[number];
export interface PluginApiError extends Error {
  code: PluginApiErrorCode;
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
  revision: number;
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
}

/**
 * A replacement range in a note's Markdown source. Offsets use JavaScript
 * UTF-16 string indices and ranges are half-open: [from, to).
 */
export interface PluginMarkdownEdit {
  from: number;
  to: number;
  insert: string;
}

export interface PluginMarkdownEditInput {
  expectedRevision: number;
  expectedContentHash: string;
  edits: PluginMarkdownEdit[];
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

export interface PluginNoteContentQueryResult {
  notes: PluginNote[];
  totalCount: number;
  nextOffset: number | null;
}

export interface PluginNotebook {
  id: string;
  parentId: string | null;
  name: string;
  memoCount: number;
}

export interface PluginNoteRevision {
  id: string;
  noteId: string;
  revision: number;
  title: string | null;
  tags: string[];
  contentMarkdown: string;
  contentText: string;
  createdAt: string;
}

export interface PluginResource {
  id: string;
  noteId: string;
  kind: "image" | "attachment";
  mimeType: string | null;
  filename: string | null;
  byteSize: number;
  contentHash: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface PluginTag {
  name: string;
  noteCount: number;
}

export interface PluginTemplate {
  id: string;
  name: string;
  description: string | null;
  title: string | null;
  contentMarkdown: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type PluginEventMap = {
  "note.created": { note: PluginNote };
  "note.updated": { note: PluginNote };
  "note.deleted": { noteId: string };
  "tag.changed": { previousName?: string; name?: string; deleted?: boolean };
  "template.created": { template: PluginTemplate };
  "template.updated": { template: PluginTemplate };
  "template.deleted": { templateId: string };
  "resource.created": { resource: PluginResource };
  "resource.updated": { resource: PluginResource };
  "resource.deleted": { resourceId: string };
  "workspace.sync-queue-changed": Record<string, never>;
  "workspace.synced": { bootstrapped: boolean; changed: number };
};

export interface PluginCommand {
  id: string;
  title: string;
  run: () => void | Promise<void>;
}

export type PluginScheduleMissedRunPolicy = "run-once" | "skip";

export interface PluginScheduleInput {
  /** Stable plugin-local identifier. Reusing it updates the same persistent schedule. */
  key: string;
  name: string;
  commandId: string;
  cronExpression: string;
  timezone?: string;
  missedRunPolicy?: PluginScheduleMissedRunPolicy;
  isEnabled?: boolean;
}

export interface PluginSchedule extends Required<Omit<PluginScheduleInput, "timezone" | "missedRunPolicy" | "isEnabled">> {
  timezone: string;
  missedRunPolicy: PluginScheduleMissedRunPolicy;
  isEnabled: boolean;
  runsOnThisDevice: boolean;
  lastRun: {
    status: "running" | "succeeded" | "failed";
    scheduledFor: string;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
}

export interface PluginEditorSelection {
  noteId: string;
  from: number;
  to: number;
  empty: boolean;
  text: string;
  contentMarkdown: string;
}

export interface PluginEditorDocument {
  noteId: string;
  contentMarkdown: string;
  hasUnsavedChanges: boolean;
}

export interface PluginOpenNoteOptions {
  /** Opens in-note search and reveals the first exact text match. */
  search?: string;
}

export type PluginJsonValue = null | boolean | number | string | PluginJsonValue[] | { [key: string]: PluginJsonValue };
export type PluginPanelPresentation = "dialog" | "fullscreen";

export interface PluginPanelOpenOptions {
  state?: PluginJsonValue;
}

export interface PluginPanelMountContext {
  state: PluginJsonValue | null;
  requestClose(): Promise<void>;
}

export type PluginPanelCloseDecision = boolean | {
  title: string;
  message: string;
  confirmLabel?: string;
};

export interface PluginEmbedInput {
  type: string;
  resourceId: string;
  previewResourceId?: string;
  title?: string;
  data?: PluginJsonValue;
}

export interface PluginEmbedInstance extends PluginEmbedInput {
  id: string;
  pluginId: string;
  previewResourceId: string;
  title: string;
  data: PluginJsonValue;
}

export interface PluginEmbedRenderer {
  type: string;
  mount(container: HTMLElement, embed: PluginEmbedInstance): void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginPanel {
  id: string;
  title: string;
  presentation?: PluginPanelPresentation;
  mount(container: HTMLElement, context: PluginPanelMountContext): void | (() => void) | Promise<void | (() => void)>;
  beforeClose?(): PluginPanelCloseDecision | Promise<PluginPanelCloseDecision>;
}

export interface PluginContext {
  pluginId: string;
  notes: {
    query(input?: PluginNoteQuery): Promise<PluginNoteQueryResult>;
    queryContent(input?: PluginNoteQuery): Promise<PluginNoteContentQueryResult>;
    get(noteId: string): Promise<PluginNote>;
    editMarkdown(noteId: string, input: PluginMarkdownEditInput): Promise<PluginNote>;
    create(input: PluginNoteCreateInput): Promise<PluginNote>;
    update(noteId: string, input: PluginNoteUpdateInput): Promise<PluginNote>;
    delete(noteId: string, options?: { permanent?: boolean }): Promise<void>;
    move(noteIds: string[], notebookId: string): Promise<number>;
    pin(noteIds: string[], isPinned: boolean): Promise<number>;
    restore(noteId: string): Promise<PluginNote>;
    revisions: {
      list(noteId: string): Promise<PluginNoteRevision[]>;
      restore(noteId: string, revisionId: string): Promise<PluginNote>;
    };
  };
  notebooks: {
    list(): Promise<PluginNotebook[]>;
    create(input: { name: string; parentId?: string | null }): Promise<PluginNotebook>;
    update(notebookId: string, input: { name?: string; parentId?: string | null; sortOrder?: number }): Promise<PluginNotebook>;
    delete(notebookId: string): Promise<void>;
  };
  tags: {
    list(): Promise<PluginTag[]>;
    rename(name: string, nextName: string): Promise<number>;
    delete(name: string): Promise<number>;
  };
  templates: {
    list(): Promise<PluginTemplate[]>;
    create(input: { name: string; description?: string | null; noteId?: string; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<PluginTemplate>;
    update(templateId: string, input: { name?: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<PluginTemplate>;
    delete(templateId: string): Promise<void>;
    use(templateId: string, notebookId: string): Promise<PluginNote>;
  };
  commands: {
    register(command: PluginCommand): () => void;
  };
  schedules: {
    /** Creates or updates one persistent schedule owned by this plugin. Desktop only. */
    upsert(input: PluginScheduleInput): Promise<PluginSchedule>;
    list(): Promise<PluginSchedule[]>;
    remove(key: string): Promise<void>;
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
    getDocument(): Promise<PluginEditorDocument | null>;
    editMarkdown(edits: PluginMarkdownEdit[]): Promise<PluginEditorDocument>;
    insertEmbed(input: PluginEmbedInput): Promise<PluginEmbedInstance>;
    embeds: {
      register(renderer: PluginEmbedRenderer): () => void;
    };
    replaceSelection(contentMarkdown: string): Promise<void>;
    insertAtCursor(contentMarkdown: string): Promise<void>;
  };
  resources: {
    list(noteId?: string): Promise<PluginResource[]>;
    read(resourceId: string): Promise<Blob>;
    upload(noteId: string, file: File): Promise<PluginResource>;
    update(resourceId: string, input: { file: File; expectedContentHash: string }): Promise<PluginResource>;
    rename(resourceId: string, filename: string): Promise<PluginResource>;
    delete(resourceId: string): Promise<void>;
  };
  settings: {
    get(key: string): Promise<PluginSettingValue | null>;
    set(key: string, value: PluginSettingValue): Promise<void>;
    remove(key: string): Promise<void>;
  };
  network: {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
  ui: {
    showNotice(message: string): void;
    openNote(noteId: string, options?: PluginOpenNoteOptions): Promise<void>;
    panels: {
      register(panel: PluginPanel): () => void;
      open(panelId: string, options?: PluginPanelOpenOptions): Promise<void>;
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

const SETTING_KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;

const normalizePluginSettings = (value: unknown): PluginSettingsSchema => {
  if (!isRecord(value) || !Array.isArray(value.fields)) throw new Error("Plugin settings must contain a fields array.");
  if (value.fields.length > 50) throw new Error("Plugin settings cannot contain more than 50 fields.");
  const keys = new Set<string>();
  const fields = value.fields.map((field): PluginSettingField => {
    if (!isRecord(field) || typeof field.key !== "string" || !SETTING_KEY_PATTERN.test(field.key)) {
      throw new Error("Plugin setting keys must start with a lowercase letter and contain only lowercase letters, numbers, dots, dashes, or underscores.");
    }
    if (keys.has(field.key)) throw new Error(`Duplicate plugin setting key: ${field.key}`);
    keys.add(field.key);
    if (typeof field.label !== "string" || !field.label.trim() || field.label.length > 200) throw new Error(`Plugin setting ${field.key} requires a label of at most 200 characters.`);
    if (typeof field.description === "string" && field.description.length > 1000) throw new Error(`Plugin setting ${field.key} description is too long.`);
    const common = {
      key: field.key,
      label: field.label.trim(),
      ...(typeof field.description === "string" && field.description.trim() ? { description: field.description.trim() } : {}),
      ...(field.required === true ? { required: true } : {}),
    };
    if (field.type === "text" || field.type === "secret") {
      if (field.type === "secret" && field.default !== undefined) throw new Error(`Secret setting ${field.key} cannot declare a default value.`);
      if (field.default !== undefined && typeof field.default !== "string") throw new Error(`Plugin setting ${field.key} default must be a string.`);
      if (field.placeholder !== undefined && typeof field.placeholder !== "string") throw new Error(`Plugin setting ${field.key} placeholder must be a string.`);
      return {
        ...common,
        type: field.type,
        ...(typeof field.default === "string" ? { default: field.default } : {}),
        ...(typeof field.placeholder === "string" ? { placeholder: field.placeholder } : {}),
      } as PluginSettingField;
    }
    if (field.type === "number") {
      for (const key of ["default", "min", "max", "step"] as const) {
        if (field[key] !== undefined && (typeof field[key] !== "number" || !Number.isFinite(field[key]))) {
          throw new Error(`Plugin setting ${field.key} ${key} must be a finite number.`);
        }
      }
      if (typeof field.min === "number" && typeof field.max === "number" && field.min > field.max) throw new Error(`Plugin setting ${field.key} min cannot exceed max.`);
      if (typeof field.step === "number" && field.step <= 0) throw new Error(`Plugin setting ${field.key} step must be positive.`);
      if (typeof field.default === "number" && ((typeof field.min === "number" && field.default < field.min) || (typeof field.max === "number" && field.default > field.max))) {
        throw new Error(`Plugin setting ${field.key} default is outside its allowed range.`);
      }
      return { ...common, type: "number", ...Object.fromEntries(["default", "min", "max", "step"].flatMap((key) => typeof field[key] === "number" ? [[key, field[key]]] : [])) } as PluginSettingField;
    }
    if (field.type === "boolean") {
      if (field.default !== undefined && typeof field.default !== "boolean") throw new Error(`Plugin setting ${field.key} default must be a boolean.`);
      return { ...common, type: "boolean", ...(typeof field.default === "boolean" ? { default: field.default } : {}) };
    }
    if (field.type === "select") {
      if (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > 100) throw new Error(`Plugin setting ${field.key} requires between 1 and 100 select options.`);
      const optionValues = new Set<string>();
      const options = field.options.map((option) => {
        if (!isRecord(option) || typeof option.value !== "string" || !option.value || typeof option.label !== "string" || !option.label.trim()) {
          throw new Error(`Plugin setting ${field.key} has an invalid select option.`);
        }
        if (optionValues.has(option.value)) throw new Error(`Plugin setting ${field.key} has a duplicate select value.`);
        optionValues.add(option.value);
        return { value: option.value, label: option.label.trim() };
      });
      if (field.default !== undefined && (typeof field.default !== "string" || !optionValues.has(field.default))) throw new Error(`Plugin setting ${field.key} default must match a select option.`);
      return { ...common, type: "select", options, ...(typeof field.default === "string" ? { default: field.default } : {}) };
    }
    throw new Error(`Plugin setting ${field.key} has an unsupported type.`);
  });
  return { fields };
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
    const settings = value.settings === undefined ? undefined : normalizePluginSettings(value.settings);
    return { ...value, type: "plugin", permissions, networkHosts, platforms, settings } as PluginManifest;
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
