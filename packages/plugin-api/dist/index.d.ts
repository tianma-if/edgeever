import type { PluginNoteKind, PluginContentDocument, PluginDiagramGraph, PluginDiagramEditInput, PluginTableDocument, PluginTableEditInput, PluginPosterDocument, PluginPosterEditInput, PluginInfographicDocument, PluginInfographicEditInput } from "./structured-notes";
export * from "./structured-notes";
export declare const PLUGIN_API_VERSION: "2";
export declare const THEME_API_VERSION: "1";
export declare const PLUGIN_PERMISSIONS: readonly ["notes:read", "notes:write", "notes:delete", "metadata:read", "metadata:write", "resources:read", "resources:write", "templates:read", "templates:write", "network", "network:public", "ai:generate", "storage", "secrets", "schedules", "editor:read", "editor:write", "ui:commands", "ui:navigation", "ui:notices", "ui:panels", "ui:embeds"];
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
    locales?: Record<string, {
        label?: string;
        description?: string;
        placeholder?: string;
        options?: Record<string, string>;
    }>;
    required?: boolean;
    /** Host-rendered read-only items, opened from a small entry next to the field. */
    list?: PluginSettingList;
}
export type PluginSettingField = (PluginSettingBase & {
    type: "text";
    default?: string;
    placeholder?: string;
}) | (PluginSettingBase & {
    type: "secret";
    placeholder?: string;
}) | (PluginSettingBase & {
    type: "number";
    default?: number;
    min?: number;
    max?: number;
    step?: number;
}) | (PluginSettingBase & {
    type: "boolean";
    default?: boolean;
}) | (PluginSettingBase & {
    type: "select";
    default?: string;
    options: Array<{
        value: string;
        label: string;
    }>;
});
export interface PluginSettingsSchema {
    /** Host-rendered fields in display order. Arbitrary UI markup and styling are intentionally unsupported. */
    fields: PluginSettingField[];
}
export type PluginSettingValue = string | number | boolean;
export declare const PLUGIN_API_ERROR_CODES: readonly ["NOTE_CONFLICT", "RESOURCE_CONFLICT", "INVALID_MARKDOWN_EDIT", "STRUCTURED_NOTE_REQUIRED", "INVALID_STRUCTURED_EDIT", "NOTE_TYPE_MISMATCH", "TABLE_DATA_CHANGES_REQUIRED", "HOST_UPGRADE_REQUIRED"];
export type PluginApiErrorCode = (typeof PLUGIN_API_ERROR_CODES)[number];
export interface PluginApiError extends Error {
    code: PluginApiErrorCode;
}
export declare const THEME_TOKEN_NAMES: readonly ["color.background", "color.surface", "color.surfaceMuted", "color.text", "color.textMuted", "color.border", "color.accent", "color.accentForeground", "color.success", "color.warning", "color.danger", "font.body", "font.mono", "font.size", "lineHeight.body", "radius.medium", "density.scale", "editor.contentWidth"];
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
export declare const MARKETPLACE_REGISTRY_VERSION: "1";
export interface MarketplaceEntry {
    id: string;
    name: string;
    description: string;
    locales?: ExtensionLocales;
    author: string;
    publisher?: "edgeever";
    category: string;
    repositoryUrl: string;
    distribution: {
        type: "github";
        repositoryUrl: string;
    } | {
        type: "manifest";
        manifestUrl: string;
    };
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
    "settings.changed": {
        key: string;
    };
    "note.created": {
        note: PluginNote;
    };
    "note.updated": {
        note: PluginNote;
    };
    "note.deleted": {
        noteId: string;
    };
    "tag.changed": {
        previousName?: string;
        name?: string;
        deleted?: boolean;
    };
    "template.created": {
        template: PluginTemplate;
    };
    "template.updated": {
        template: PluginTemplate;
    };
    "template.deleted": {
        templateId: string;
    };
    "resource.created": {
        resource: PluginResource;
    };
    "resource.updated": {
        resource: PluginResource;
    };
    "resource.deleted": {
        resourceId: string;
    };
    "workspace.sync-queue-changed": Record<string, never>;
    "workspace.synced": {
        bootstrapped: boolean;
        changed: number;
    };
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
export type PluginJsonValue = null | boolean | number | string | PluginJsonValue[] | {
    [key: string]: PluginJsonValue;
};
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
export type PluginPanelToolbarItem = {
    type: "search";
    key: string;
    placeholder?: string;
    value?: string;
} | {
    type: "tabs";
    key: string;
    value?: string;
    options: PluginPanelSelectOption[];
} | {
    type: "select";
    key: string;
    label?: string;
    value?: string;
    options: PluginPanelSelectOption[];
} | {
    type: "button";
    key: string;
    label: string;
    variant?: PluginPanelActionVariant;
    disabled?: boolean;
};
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
        status(): Promise<{
            configured: boolean;
            modelName?: string;
        }>;
        generate(input: {
            system: string;
            prompt: string;
            maxOutputTokens?: number;
            signal?: AbortSignal;
        }): Promise<{
            text: string;
        }>;
        transcribeResource(noteId: string, resourceId: string): Promise<{
            text: string;
            resourceId: string;
            filename: string;
        }>;
        transcribeMedia(media: Blob, options?: {
            signal?: AbortSignal;
        }): Promise<{
            text: string;
        }>;
    };
    notes: {
        query(input?: PluginNoteQuery): Promise<PluginNoteQueryResult>;
        queryContent(input?: PluginNoteQuery): Promise<PluginNoteContentQueryResult>;
        get(noteId: string): Promise<PluginNote>;
        editMarkdown(noteId: string, input: PluginMarkdownEditInput): Promise<PluginNote>;
        create(input: PluginNoteCreateInput): Promise<PluginNote>;
        update(noteId: string, input: PluginNoteUpdateInput): Promise<PluginNote>;
        delete(noteId: string, options?: {
            permanent?: boolean;
        }): Promise<void>;
        move(noteIds: string[], notebookId: string): Promise<number>;
        pin(noteIds: string[], isPinned: boolean): Promise<number>;
        restore(noteId: string): Promise<PluginNote>;
        revisions: {
            list(noteId: string): Promise<PluginNoteRevision[]>;
            restore(noteId: string, revisionId: string): Promise<PluginNote>;
        };
    };
    diagrams: {
        get(noteId: string, options?: {
            includeLayout?: boolean;
        }): Promise<{
            note: PluginNote;
            diagram: PluginDiagramGraph;
            editToken: string;
        }>;
        edit(noteId: string, input: PluginDiagramEditInput): Promise<{
            note: PluginNote;
            diagram: PluginDiagramGraph;
            editToken: string;
            dryRun: boolean;
        }>;
    };
    tables: {
        get(noteId: string): Promise<{
            note: PluginNote;
            table: PluginTableDocument;
            editToken: string;
        }>;
        edit(noteId: string, input: PluginTableEditInput): Promise<{
            note: PluginNote;
            table: PluginTableDocument;
            editToken: string;
            dryRun: boolean;
            changedCellCount: number;
            removedAttachmentCount: number;
        }>;
    };
    posters: {
        capabilities(): Promise<{
            templates: string[];
            platforms: Array<{
                id: string;
                width: number;
                height: number;
            }>;
            fonts: string[];
            editableFields: string[];
            limits: {
                maxElements: number;
                maxOperations: number;
                canvasMin: number;
                canvasMax: number;
            };
        }>;
        get(noteId: string): Promise<{
            note: PluginNote;
            poster: PluginPosterDocument;
            editToken: string;
        }>;
        edit(noteId: string, input: PluginPosterEditInput): Promise<{
            note: PluginNote;
            poster: PluginPosterDocument;
            editToken: string;
            dryRun: boolean;
            changed: boolean;
        }>;
    };
    infographics: {
        capabilities(): Promise<{
            templates: string[];
            themes: string[];
            maxOperations: number;
        }>;
        get(noteId: string): Promise<{
            note: PluginNote;
            infographic: PluginInfographicDocument;
            data: Record<string, PluginJsonValue>;
            template: string;
            theme?: string;
            editToken: string;
        }>;
        edit(noteId: string, input: PluginInfographicEditInput): Promise<{
            note: PluginNote;
            infographic: PluginInfographicDocument;
            editToken: string;
            dryRun: boolean;
            changed: boolean;
        }>;
    };
    notebooks: {
        list(): Promise<PluginNotebook[]>;
        create(input: {
            name: string;
            parentId?: string | null;
        }): Promise<PluginNotebook>;
        update(notebookId: string, input: {
            name?: string;
            parentId?: string | null;
            sortOrder?: number;
        }): Promise<PluginNotebook>;
        delete(notebookId: string): Promise<void>;
    };
    tags: {
        list(): Promise<PluginTag[]>;
        rename(name: string, nextName: string): Promise<number>;
        delete(name: string): Promise<number>;
    };
    templates: {
        list(): Promise<PluginTemplate[]>;
        create(input: {
            name: string;
            description?: string | null;
            noteId?: string;
            title?: string | null;
            contentMarkdown?: string;
            tags?: string[];
        }): Promise<PluginTemplate>;
        update(templateId: string, input: {
            name?: string;
            description?: string | null;
            title?: string | null;
            contentMarkdown?: string;
            tags?: string[];
        }): Promise<PluginTemplate>;
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
        update(resourceId: string, input: {
            file: File;
            expectedContentHash: string;
        }): Promise<PluginResource>;
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
        fetch(input: string, init?: RequestInit & {
            transport?: "direct" | "public";
        }): Promise<Response>;
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
export declare const definePlugin: <T extends EdgeEverPlugin>(plugin: T) => T;
export declare const defineTheme: <T extends ThemeManifest>(theme: T) => T;
/** Strips unknown fields and clamps sizes so host chrome rendering stays bounded. */
export declare const normalizePluginPanelChrome: (value: PluginPanelChrome | null | undefined) => PluginPanelChrome;
export declare const parseExtensionManifest: (value: unknown) => ExtensionManifest;
export declare const isReservedMarketplacePluginId: (id: string) => boolean;
export declare const parseMarketplaceRegistry: (value: unknown) => MarketplaceRegistry;
/**
 * Overlay a signed community registry onto the bundled official list.
 * Official entries, their repository URLs, and `publisher: "edgeever"` stay
 * on the bundled list. A signature does not make a remote entry official.
 */
export declare const mergeCommunityMarketplace: (bundled: MarketplaceRegistry, community: MarketplaceRegistry | null, revokedIds: ReadonlySet<string>) => MarketplaceRegistry;
/** Revocation ids only grow. A later record may replace the reason, never remove the id. */
export declare const rememberMarketplaceRevocations: (existing: readonly MarketplaceRevocation[], incoming: readonly MarketplaceRevocation[]) => MarketplaceRevocation[];
