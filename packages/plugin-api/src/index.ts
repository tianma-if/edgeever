import type { PluginNoteKind, PluginContentDocument, PluginDiagramGraph, PluginDiagramEditInput, PluginTableDocument, PluginTableEditInput, PluginPosterDocument, PluginPosterEditInput, PluginInfographicDocument, PluginInfographicEditInput } from "./structured-notes";
export * from "./structured-notes";
export const PLUGIN_API_VERSION = "2" as const;
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
  "network:public",
  "ai:generate",
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

export interface LocalizedExtensionMetadata {
  name?: string;
  description?: string;
}

export type ExtensionLocales = Record<string, LocalizedExtensionMetadata>;

export interface PluginManifest {
  type: "plugin";
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  /** Plugins must delegate ordinary persistent configuration to EdgeEver. */
  settingsUi: "host";
  description?: string;
  /** Localized marketplace and manager copy keyed by a BCP 47 language tag. */
  locales?: ExtensionLocales;
  author?: string;
  entry: string;
  platforms?: ExtensionPlatform[];
  permissions: PluginPermission[];
  networkHosts?: string[];
  settings?: PluginSettingsSchema;
}

export interface PluginSettingListItem {
  title: string;
  description?: string;
}

export interface PluginSettingList {
  title?: string;
  actionLabel?: string;
  items: PluginSettingListItem[];
}

/**
 * Declarative setting metadata. EdgeEver owns the layout, controls, validation,
 * state feedback, and responsive behavior; plugins cannot supply presentation code or styles.
 */
interface PluginSettingBase {
  key: string;
  label: string;
  description?: string;
  locales?: Record<string, { label?: string; description?: string; placeholder?: string; options?: Record<string, string> }>;
  required?: boolean;
  /** Host-rendered read-only items, opened from a small entry next to the field. */
  list?: PluginSettingList;
}

export type PluginSettingField =
  | (PluginSettingBase & { type: "text"; default?: string; placeholder?: string })
  | (PluginSettingBase & { type: "secret"; placeholder?: string })
  | (PluginSettingBase & { type: "number"; default?: number; min?: number; max?: number; step?: number })
  | (PluginSettingBase & { type: "boolean"; default?: boolean })
  | (PluginSettingBase & { type: "select"; default?: string; options: Array<{ value: string; label: string }> });

export interface PluginSettingsSchema {
  /** Host-rendered fields in display order. Arbitrary UI markup and styling are intentionally unsupported. */
  fields: PluginSettingField[];
}

export type PluginSettingValue = string | number | boolean;

export const PLUGIN_API_ERROR_CODES = ["NOTE_CONFLICT", "RESOURCE_CONFLICT", "INVALID_MARKDOWN_EDIT", "STRUCTURED_NOTE_REQUIRED", "INVALID_STRUCTURED_EDIT", "NOTE_TYPE_MISMATCH", "TABLE_DATA_CHANGES_REQUIRED", "HOST_UPGRADE_REQUIRED"] as const;
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
  /** Localized marketplace and manager copy keyed by a BCP 47 language tag. */
  locales?: ExtensionLocales;
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
  locales?: ExtensionLocales;
  author: string;
  publisher?: "edgeever";
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
  /** SPDX license identifier recorded when a community plugin was admitted. */
  licenseSpdx?: string;
  /** 40-character commit recorded for a community plugin release. */
  sourceRevision?: string;
  /** Plugin API version this community entry was admitted against. */
  apiVersion?: string;
  /** Theme API version this community entry was admitted against. */
  themeApiVersion?: string;
  /** Capability snapshot used to detect a later permission expansion. */
  admitted?: {
    permissions: string[];
    networkHosts: string[];
  };
  /**
   * Set only by the client after a signed community registry is merged.
   * Remote files cannot claim this field.
   */
  listing?: "community";
}

export interface MarketplaceRevocation {
  id: string;
  reason: string;
  revokedAt: string;
}

export interface MarketplaceRegistry {
  registryVersion: typeof MARKETPLACE_REGISTRY_VERSION;
  updatedAt: string;
  entries: MarketplaceEntry[];
  revocations?: MarketplaceRevocation[];
}

export interface PluginNoteSummary {
  kind: PluginNoteKind;
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
  /** Full persisted document; read-only through this API. Special payloads also live in contentMarkdown. */
  contentJson: PluginContentDocument;
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
  sort?: "updated-desc" | "created-desc" | "title-asc" | "title-desc";
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
  "settings.changed": { key: string };
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
  /**
   * When false, the command stays in the plugin toolbar menu but is omitted from
   * marketplace and plugin-manager cards. Defaults to true.
   */
  listed?: boolean;
  /**
   * When false, the command is omitted from the plugin toolbar menu.
   * Use this for a card-only launcher that already has a dashboard panel in the menu.
   * Defaults to true.
   */
  menu?: boolean;
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
export type PluginPanelPurpose = "workflow" | "dashboard" | "preview" | "onboarding";

export interface PluginPanelOpenOptions {
  state?: PluginJsonValue;
}

export type PluginPanelActionVariant = "default" | "primary" | "ghost";

export interface PluginPanelAction {
  id: string;
  label: string;
  variant?: PluginPanelActionVariant;
  disabled?: boolean;
}

export interface PluginPanelSelectOption {
  value: string;
  label: string;
}

export type PluginPanelToolbarItem =
  | { type: "search"; key: string; placeholder?: string; value?: string }
  | { type: "tabs"; key: string; value?: string; options: PluginPanelSelectOption[] }
  | { type: "select"; key: string; label?: string; value?: string; options: PluginPanelSelectOption[] }
  | { type: "button"; key: string; label: string; variant?: PluginPanelActionVariant; disabled?: boolean };

export interface PluginPanelEmptyState {
  title: string;
  description?: string;
  action?: PluginPanelAction;
}

/**
 * Host-rendered panel chrome. Plugins describe intent; EdgeEver owns layout and controls.
 * Callbacks stay in-memory and are not serialized with panel open state.
 */
export interface PluginPanelChrome {
  header?: {
    title?: string;
    /** Pass `null` to hide the host's default panel description. */
    description?: string | null;
    actions?: PluginPanelAction[];
  };
  toolbar?: PluginPanelToolbarItem[];
  empty?: PluginPanelEmptyState | null;
  onAction?: (id: string) => void;
  onChange?: (key: string, value: string) => void;
}

export interface PluginPanelShell {
  set(chrome: PluginPanelChrome): void;
}

export interface PluginPanelMountContext {
  state: PluginJsonValue | null;
  requestClose(): Promise<void>;
  /** Host-rendered header, toolbar, and empty state. `set` is a no-op when the host has no chrome adapter. */
  shell: PluginPanelShell;
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
  /** Business purpose of this panel. Custom settings pages are intentionally unsupported. */
  purpose: PluginPanelPurpose;
  presentation?: PluginPanelPresentation;
  mount(container: HTMLElement, context: PluginPanelMountContext): void | (() => void) | Promise<void | (() => void)>;
  beforeClose?(): PluginPanelCloseDecision | Promise<PluginPanelCloseDecision>;
}

export interface PluginContext {
  pluginId: string;
  ai: {
    status(): Promise<{ configured: boolean; modelName?: string }>;
    generate(input: { system: string; prompt: string; maxOutputTokens?: number; signal?: AbortSignal }): Promise<{ text: string }>;
    transcribeResource(noteId: string, resourceId: string): Promise<{ text: string; resourceId: string; filename: string }>;
    transcribeMedia(media: Blob, options?: { signal?: AbortSignal }): Promise<{ text: string }>;
  };
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
  diagrams: {
    get(noteId: string, options?: { includeLayout?: boolean }): Promise<{ note: PluginNote; diagram: PluginDiagramGraph; editToken: string }>;
    edit(noteId: string, input: PluginDiagramEditInput): Promise<{ note: PluginNote; diagram: PluginDiagramGraph; editToken: string; dryRun: boolean }>;
  };
  tables: {
    get(noteId: string): Promise<{ note: PluginNote; table: PluginTableDocument; editToken: string }>;
    edit(noteId: string, input: PluginTableEditInput): Promise<{ note: PluginNote; table: PluginTableDocument; editToken: string; dryRun: boolean; changedCellCount: number; removedAttachmentCount: number }>;
  };
  posters: {
    capabilities(): Promise<{ templates: string[]; platforms: Array<{ id: string; width: number; height: number }>; fonts: string[]; editableFields: string[]; limits: { maxElements: number; maxOperations: number; canvasMin: number; canvasMax: number } }>;
    get(noteId: string): Promise<{ note: PluginNote; poster: PluginPosterDocument; editToken: string }>;
    edit(noteId: string, input: PluginPosterEditInput): Promise<{ note: PluginNote; poster: PluginPosterDocument; editToken: string; dryRun: boolean; changed: boolean }>;
  };
  infographics: {
    capabilities(): Promise<{ templates: string[]; themes: string[]; maxOperations: number }>;
    get(noteId: string): Promise<{ note: PluginNote; infographic: PluginInfographicDocument; data: Record<string, PluginJsonValue>; template: string; theme?: string; editToken: string }>;
    edit(noteId: string, input: PluginInfographicEditInput): Promise<{ note: PluginNote; infographic: PluginInfographicDocument; editToken: string; dryRun: boolean; changed: boolean }>;
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
    /** direct preserves browser fetch. public uses authenticated, bounded HTTPS GET/HEAD transport. */
    fetch(input: string, init?: RequestInit & { transport?: "direct" | "public" }): Promise<Response>;
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

const PANEL_CHROME_ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const PANEL_ACTION_VARIANTS = new Set<PluginPanelActionVariant>(["default", "primary", "ghost"]);

const clipChromeText = (value: unknown, fallback = "", max = 200) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const normalizePanelAction = (value: unknown): PluginPanelAction | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !PANEL_CHROME_ID.test(value.id)) return null;
  const label = clipChromeText(value.label);
  if (!label) return null;
  const variant = PANEL_ACTION_VARIANTS.has(value.variant as PluginPanelActionVariant) ? value.variant as PluginPanelActionVariant : undefined;
  return { id: value.id, label, ...(variant ? { variant } : {}), ...(value.disabled === true ? { disabled: true } : {}) };
};

const normalizePanelOptions = (value: unknown): PluginPanelSelectOption[] => {
  if (!Array.isArray(value)) return [];
  const options: PluginPanelSelectOption[] = [];
  for (const item of value.slice(0, 24)) {
    if (!isRecord(item) || typeof item.value !== "string" || !item.value || item.value.length > 64) continue;
    const label = clipChromeText(item.label, item.value);
    options.push({ value: item.value, label });
  }
  return options;
};

const normalizeToolbarItem = (value: unknown): PluginPanelToolbarItem | null => {
  if (!isRecord(value) || typeof value.key !== "string" || !PANEL_CHROME_ID.test(value.key)) return null;
  if (value.type === "search") {
    return {
      type: "search",
      key: value.key,
      ...(typeof value.placeholder === "string" ? { placeholder: clipChromeText(value.placeholder, "", 80) } : {}),
      ...(typeof value.value === "string" ? { value: value.value.slice(0, 200) } : {}),
    };
  }
  if (value.type === "tabs" || value.type === "select") {
    const options = normalizePanelOptions(value.options);
    if (!options.length) return null;
    const selected = typeof value.value === "string" && options.some((option) => option.value === value.value) ? value.value : options[0].value;
    return {
      type: value.type,
      key: value.key,
      value: selected,
      options,
      ...(value.type === "select" && typeof value.label === "string" ? { label: clipChromeText(value.label, "", 40) } : {}),
    };
  }
  if (value.type === "button") {
    const action = normalizePanelAction({ ...value, id: value.key });
    if (!action) return null;
    return { type: "button", key: value.key, label: action.label, ...(action.variant ? { variant: action.variant } : {}), ...(action.disabled ? { disabled: true } : {}) };
  }
  return null;
};

/** Strips unknown fields and clamps sizes so host chrome rendering stays bounded. */
export const normalizePluginPanelChrome = (value: PluginPanelChrome | null | undefined): PluginPanelChrome => {
  if (!isRecord(value)) return {};
  const chrome: PluginPanelChrome = {};
  if (isRecord(value.header)) {
    const actions = Array.isArray(value.header.actions)
      ? value.header.actions.map(normalizePanelAction).filter((action): action is PluginPanelAction => Boolean(action)).slice(0, 8)
      : [];
    chrome.header = {
      ...(typeof value.header.title === "string" ? { title: clipChromeText(value.header.title, "", 80) } : {}),
      ...(value.header.description === null ? { description: null } : typeof value.header.description === "string" ? { description: clipChromeText(value.header.description, "", 200) } : {}),
      ...(actions.length ? { actions } : {}),
    };
  }
  if (Array.isArray(value.toolbar)) {
    chrome.toolbar = value.toolbar.map(normalizeToolbarItem).filter((item): item is PluginPanelToolbarItem => Boolean(item)).slice(0, 16);
  }
  if (value.empty === null) chrome.empty = null;
  else if (isRecord(value.empty)) {
    const title = clipChromeText(value.empty.title, "", 80);
    if (title) {
      chrome.empty = {
        title,
        ...(typeof value.empty.description === "string" ? { description: clipChromeText(value.empty.description) } : {}),
        ...(normalizePanelAction(value.empty.action) ? { action: normalizePanelAction(value.empty.action)! } : {}),
      };
    }
  }
  if (typeof value.onAction === "function") chrome.onAction = value.onAction as PluginPanelChrome["onAction"];
  if (typeof value.onChange === "function") chrome.onChange = value.onChange as PluginPanelChrome["onChange"];
  return chrome;
};

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

const normalizeExtensionLocales = (value: unknown, label: string): ExtensionLocales | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} locales must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 50) throw new Error(`${label} cannot declare more than 50 locales.`);
  const normalizedKeys = new Set<string>();
  const locales: ExtensionLocales = {};
  for (const [rawLocale, metadata] of entries) {
    let locale: string;
    try {
      locale = Intl.getCanonicalLocales(rawLocale.trim().replaceAll("_", "-"))[0] ?? "";
    } catch {
      locale = "";
    }
    if (!locale) throw new Error(`${label} locale ${rawLocale} must be a BCP 47 language tag.`);
    const normalizedKey = locale.toLocaleLowerCase();
    if (normalizedKeys.has(normalizedKey)) throw new Error(`${label} contains a duplicate locale: ${locale}.`);
    normalizedKeys.add(normalizedKey);
    if (!isRecord(metadata)) throw new Error(`${label} locale ${locale} must be an object.`);
    if (metadata.name !== undefined && (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 200)) {
      throw new Error(`${label} locale ${locale} name must be between 1 and 200 characters.`);
    }
    if (metadata.description !== undefined && (typeof metadata.description !== "string" || !metadata.description.trim() || metadata.description.length > 2000)) {
      throw new Error(`${label} locale ${locale} description must be between 1 and 2000 characters.`);
    }
    if (metadata.name === undefined && metadata.description === undefined) {
      throw new Error(`${label} locale ${locale} must declare a name or description.`);
    }
    locales[locale] = {
      ...(typeof metadata.name === "string" ? { name: metadata.name.trim() } : {}),
      ...(typeof metadata.description === "string" ? { description: metadata.description.trim() } : {}),
    };
  }
  return locales;
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

const normalizeSettingLocales = (value: unknown, key: string, type: string, optionValues: string[]) => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 50) throw new Error(`Plugin setting ${key} locales must be an object with at most 50 entries.`);
  const locales: NonNullable<PluginSettingBase["locales"]> = {};
  for (const [rawLocale, copy] of Object.entries(value)) {
    let locale: string;
    try { locale = Intl.getCanonicalLocales(rawLocale.trim().replaceAll("_", "-"))[0] ?? ""; } catch { locale = ""; }
    if (!locale || Object.keys(locales).some((existing) => existing.toLocaleLowerCase() === locale.toLocaleLowerCase())) {
      throw new Error(`Plugin setting ${key} has an invalid or duplicate locale: ${rawLocale}.`);
    }
    if (!isRecord(copy)) throw new Error(`Plugin setting ${key} locale ${locale} must be an object.`);
    const localized: NonNullable<PluginSettingBase["locales"]>[string] = {};
    for (const property of ["label", "description", "placeholder"] as const) {
      if (copy[property] === undefined) continue;
      const limit = property === "description" ? 1000 : 200;
      if (typeof copy[property] !== "string" || !copy[property].trim() || copy[property].length > limit || (property === "placeholder" && type !== "text" && type !== "secret")) {
        throw new Error(`Plugin setting ${key} locale ${locale} has an invalid ${property}.`);
      }
      localized[property] = copy[property].trim();
    }
    if (copy.options !== undefined) {
      if (type !== "select" || !isRecord(copy.options) || Object.keys(copy.options).some((option) => !optionValues.includes(option))) {
        throw new Error(`Plugin setting ${key} locale ${locale} has invalid options.`);
      }
      const translatedOptions: Array<[string, string]> = [];
      for (const [option, label] of Object.entries(copy.options)) {
        if (typeof label !== "string" || !label.trim() || label.length > 200) throw new Error(`Plugin setting ${key} locale ${locale} has an invalid option label.`);
        translatedOptions.push([option, label.trim()]);
      }
      localized.options = Object.fromEntries(translatedOptions);
    }
    if (Object.keys(localized).length === 0) throw new Error(`Plugin setting ${key} locale ${locale} must include translated copy.`);
    locales[locale] = localized;
  }
  return locales;
};

const normalizeSettingList = (field: Record<string, unknown>, key: string): PluginSettingList | undefined => {
  if (field.list === undefined) return undefined;
  if (!isRecord(field.list) || !Array.isArray(field.list.items) || field.list.items.length === 0 || field.list.items.length > 100) {
    throw new Error(`Plugin setting ${key} list requires between 1 and 100 items.`);
  }
  if (field.list.title !== undefined && (typeof field.list.title !== "string" || !field.list.title.trim() || field.list.title.length > 200)) {
    throw new Error(`Plugin setting ${key} list title must be at most 200 characters.`);
  }
  if (field.list.actionLabel !== undefined && (typeof field.list.actionLabel !== "string" || !field.list.actionLabel.trim() || field.list.actionLabel.length > 40)) {
    throw new Error(`Plugin setting ${key} list action label must be at most 40 characters.`);
  }
  const items = field.list.items.map((item, index): PluginSettingListItem => {
    if (!isRecord(item) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200) {
      throw new Error(`Plugin setting ${key} list item ${index + 1} requires a title of at most 200 characters.`);
    }
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 200)) {
      throw new Error(`Plugin setting ${key} list item ${index + 1} description is too long.`);
    }
    return {
      title: item.title.trim(),
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
    };
  });
  return {
    items,
    ...(typeof field.list.title === "string" ? { title: field.list.title.trim() } : {}),
    ...(typeof field.list.actionLabel === "string" ? { actionLabel: field.list.actionLabel.trim() } : {}),
  };
};

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
    const list = normalizeSettingList(field, field.key);
    const optionValues = field.type === "select" && Array.isArray(field.options)
      ? field.options.filter(isRecord).map((option) => String(option.value)) : [];
    const locales = normalizeSettingLocales(field.locales, field.key, String(field.type), optionValues);
    const common = {
      key: field.key,
      label: field.label.trim(),
      ...(locales ? { locales } : {}),
      ...(typeof field.description === "string" && field.description.trim() ? { description: field.description.trim() } : {}),
      ...(field.required === true ? { required: true } : {}),
      ...(list ? { list } : {}),
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
  const locales = normalizeExtensionLocales(value.locales, `Extension ${String(value.id)}`);

  if (value.type === "plugin") {
    if (value.apiVersion !== PLUGIN_API_VERSION) throw new Error(`Unsupported plugin API version: ${String(value.apiVersion)}`);
    if (value.settingsUi !== "host") {
      throw new Error('Plugin API v2 requires settingsUi to be "host".');
    }
    if (typeof value.entry !== "string" || !value.entry.trim()) throw new Error("Plugin entry is required.");
    if (value.permissions !== undefined && !Array.isArray(value.permissions)) throw new Error("Plugin permissions must be an array.");
    const allowedPermissions = new Set<string>(PLUGIN_PERMISSIONS);
    const permissions = [...new Set((value.permissions ?? []).map(String))];
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
    const platforms = value.platforms === undefined
      ? undefined
      : Array.isArray(value.platforms) && value.platforms.every((platform) => ["web", "desktop", "android", "ios"].includes(String(platform)))
        ? [...new Set(value.platforms.map(String))] as ExtensionPlatform[]
        : (() => { throw new Error("Plugin platforms contains an unsupported platform."); })();
    const settings = value.settings === undefined ? undefined : normalizePluginSettings(value.settings);
    return {
      ...value,
      type: "plugin",
      permissions,
      networkHosts,
      platforms,
      settings,
      ...(locales ? { locales } : {}),
    } as PluginManifest;
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
      ...(locales ? { locales } : {}),
    } as ThemeManifest;
  }

  throw new Error("Extension type must be plugin or theme.");
};

const normalizeChecksum = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return value.toLocaleLowerCase();
};
const GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i;
const SPDX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const API_VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/;
const NETWORK_HOST_PATTERN = /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

export const isReservedMarketplacePluginId = (id: string) =>
  id === "org.edgeever" || id.startsWith("org.edgeever.");

const readOptionalToken = (
  value: unknown,
  pattern: RegExp,
  label: string,
  normalize?: (value: string) => string,
) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(label);
  return normalize ? normalize(value) : value;
};

const readAdmittedSnapshot = (value: unknown, id: string): MarketplaceEntry["admitted"] => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.permissions) || !Array.isArray(value.networkHosts)) {
    throw new Error(`Marketplace entry ${id} has an invalid admission snapshot.`);
  }
  const allowedPermissions = new Set<string>(PLUGIN_PERMISSIONS);
  const permissions = [...new Set(value.permissions.map(String))];
  const unsupported = permissions.find((permission) => !allowedPermissions.has(permission));
  if (unsupported) throw new Error(`Marketplace entry ${id} has an unsupported admitted permission.`);
  const networkHosts = [...new Set(value.networkHosts.map(String))];
  if (networkHosts.some((host) => !NETWORK_HOST_PATTERN.test(host))) {
    throw new Error(`Marketplace entry ${id} has an invalid admitted network host.`);
  }
  return { permissions, networkHosts };
};

const readRevocations = (value: unknown): MarketplaceRevocation[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Marketplace revocations must be an array.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) {
      throw new Error("Marketplace revocation id is invalid.");
    }
    if (ids.has(item.id)) throw new Error(`Duplicate marketplace revocation id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.reason !== "string" || !item.reason.trim() || item.reason.trim().length > 500) {
      throw new Error(`Marketplace revocation ${item.id} is missing a reason.`);
    }
    if (typeof item.revokedAt !== "string" || Number.isNaN(Date.parse(item.revokedAt))) {
      throw new Error(`Marketplace revocation ${item.id} has an invalid revokedAt.`);
    }
    return { id: item.id, reason: item.reason.trim(), revokedAt: item.revokedAt };
  });
};

const isInstallableCommunityEntry = (entry: MarketplaceEntry) => {
  if (entry.apiVersion && entry.themeApiVersion) return false;
  if (entry.apiVersion) return entry.apiVersion === PLUGIN_API_VERSION;
  if (entry.themeApiVersion) return entry.themeApiVersion === THEME_API_VERSION;
  return false;
};

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
    const locales = normalizeExtensionLocales(item.locales, `Marketplace entry ${item.id}`);
    if (item.publisher !== undefined && item.publisher !== "edgeever") {
      throw new Error(`Marketplace entry ${item.id} has an invalid publisher.`);
    }
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
    const licenseSpdx = readOptionalToken(item.licenseSpdx, SPDX_PATTERN, `Marketplace entry ${item.id} has an invalid SPDX license.`);
    const sourceRevision = readOptionalToken(
      item.sourceRevision,
      COMMIT_SHA_PATTERN,
      `Marketplace entry ${item.id} has an invalid source revision.`,
      (revision) => revision.toLocaleLowerCase(),
    );
    const apiVersion = readOptionalToken(item.apiVersion, API_VERSION_PATTERN, `Marketplace entry ${item.id} has an invalid apiVersion.`);
    const themeApiVersion = readOptionalToken(item.themeApiVersion, API_VERSION_PATTERN, `Marketplace entry ${item.id} has an invalid themeApiVersion.`);
    const admitted = readAdmittedSnapshot(item.admitted, item.id);
    return {
      id: item.id,
      name: name.trim(),
      description: description.trim(),
      ...(locales ? { locales } : {}),
      author: author.trim(),
      ...(item.publisher === "edgeever" ? { publisher: "edgeever" as const } : {}),
      category: category.trim(),
      repositoryUrl: repositoryUrl.trim(),
      distribution,
      verification: { version: item.verification.version, checksums },
      ...(licenseSpdx ? { licenseSpdx } : {}),
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(apiVersion ? { apiVersion } : {}),
      ...(themeApiVersion ? { themeApiVersion } : {}),
      ...(admitted ? { admitted } : {}),
    };
  });
  const revocations = readRevocations(value.revocations);
  return {
    registryVersion: MARKETPLACE_REGISTRY_VERSION,
    updatedAt: value.updatedAt,
    entries,
    ...(revocations ? { revocations } : {}),
  };
};

/**
 * Overlay a signed community registry onto the bundled official list.
 * Official entries, their repository URLs, and `publisher: "edgeever"` stay
 * on the bundled list. A signature does not make a remote entry official.
 */
export const mergeCommunityMarketplace = (
  bundled: MarketplaceRegistry,
  community: MarketplaceRegistry | null,
  revokedIds: ReadonlySet<string>,
): MarketplaceRegistry => {
  const bundledIds = new Set(bundled.entries.map((entry) => entry.id));
  const entries = bundled.entries.filter((entry) => !revokedIds.has(entry.id));
  for (const entry of community?.entries ?? []) {
    if (entry.publisher) continue;
    if (isReservedMarketplacePluginId(entry.id) || bundledIds.has(entry.id) || revokedIds.has(entry.id)) continue;
    if (entry.distribution.type !== "github" || !isInstallableCommunityEntry(entry)) continue;
    const { publisher, listing, ...rest } = entry;
    void publisher;
    void listing;
    entries.push({ ...rest, listing: "community" });
  }
  return {
    registryVersion: bundled.registryVersion,
    updatedAt: bundled.updatedAt,
    entries,
    ...(bundled.revocations ? { revocations: bundled.revocations } : {}),
  };
};

/** Revocation ids only grow. A later record may replace the reason, never remove the id. */
export const rememberMarketplaceRevocations = (
  existing: readonly MarketplaceRevocation[],
  incoming: readonly MarketplaceRevocation[],
): MarketplaceRevocation[] => {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current || Date.parse(item.revokedAt) >= Date.parse(current.revokedAt)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
};
