export declare const PLUGIN_API_VERSION: "1";
export declare const THEME_API_VERSION: "1";
export declare const PLUGIN_PERMISSIONS: readonly ["notes:read", "notes:write", "notes:delete", "metadata:read", "metadata:write", "resources:read", "resources:write", "templates:read", "templates:write", "network", "storage", "secrets", "editor:read", "editor:write", "ui:commands", "ui:navigation", "ui:notices", "ui:panels", "ui:embeds"];
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
    fields: PluginSettingField[];
}
export type PluginSettingValue = string | number | boolean;
export declare const PLUGIN_API_ERROR_CODES: readonly ["NOTE_CONFLICT", "RESOURCE_CONFLICT", "INVALID_MARKDOWN_EDIT"];
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
    author: string;
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
export declare const definePlugin: <T extends EdgeEverPlugin>(plugin: T) => T;
export declare const defineTheme: <T extends ThemeManifest>(theme: T) => T;
export declare const parseExtensionManifest: (value: unknown) => ExtensionManifest;
export declare const parseMarketplaceRegistry: (value: unknown) => MarketplaceRegistry;
export {};
