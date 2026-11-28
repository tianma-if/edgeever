import type { PluginJsonValue } from "./index";
/** Public, portable contracts for structured note editing. */
export type PluginNoteKind = "text" | "mind-map" | "flowchart" | "architecture" | "table" | "poster" | "infographic" | "video";
export interface PluginContentNode {
    type: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: Array<{
        type: string;
        attrs?: Record<string, unknown>;
    }>;
    content?: PluginContentNode[];
}
export interface PluginContentDocument {
    type: "doc";
    content: PluginContentNode[];
}
export interface PluginStructuredEditInput {
    expectedRevision: number;
    expectedContentHash: string;
    /** Snapshot token from diagrams.get()/tables.get(); also detects unsynced local edits. */
    expectedEditToken: string;
    /** Validate and preview without saving. */
    dryRun?: boolean;
}
export type PluginDiagramNodeType = "topic" | "process" | "decision" | "start" | "end" | "terminator" | "client" | "frontend" | "service" | "database" | "storage" | "queue" | "security" | "external" | "boundary";
export interface PluginDiagramNode {
    id: string;
    label: string;
    type?: PluginDiagramNodeType;
    parentId?: string;
    resourceIcon?: string;
}
export interface PluginDiagramEdge {
    id?: string;
    source: string;
    target: string;
    label?: string;
    type?: "dependency" | "request" | "async" | "data";
    bidirectional?: boolean;
}
export interface PluginDiagramGraph {
    kind: "mind-map" | "flowchart" | "architecture";
    theme?: string;
    structure?: string;
    nodes: Array<PluginDiagramNode & {
        layout?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    }>;
    edges: Array<PluginDiagramEdge & {
        id: string;
    }>;
}
export type PluginDiagramOperation = {
    op: "add_node";
    node: PluginDiagramNode;
} | {
    op: "update_node";
    nodeId: string;
    changes: Partial<Omit<PluginDiagramNode, "id" | "parentId" | "resourceIcon">> & {
        parentId?: string | null;
        resourceIcon?: string | null;
    };
} | {
    op: "remove_node";
    nodeId: string;
    cascade?: boolean;
} | {
    op: "add_edge";
    edge: PluginDiagramEdge;
} | {
    op: "update_edge";
    edgeId: string;
    changes: Partial<Omit<PluginDiagramEdge, "id" | "label" | "type" | "bidirectional">> & {
        label?: string | null;
        type?: PluginDiagramEdge["type"] | null;
        bidirectional?: boolean | null;
    };
} | {
    op: "remove_edge";
    edgeId: string;
};
export interface PluginDiagramEditInput extends PluginStructuredEditInput {
    operations: PluginDiagramOperation[];
    reflow?: "preserve" | "all";
}
export type PluginTableFieldType = "text" | "number" | "checkbox" | "date" | "select" | "multiSelect" | "url" | "phone" | "email" | "autoNumber" | "attachment" | "createdTime" | "updatedTime" | "progress" | "rating" | "currency" | "percent";
export interface PluginTableField {
    id: string;
    name: string;
    type: PluginTableFieldType;
    options?: string[];
}
export interface PluginTableAttachment {
    resourceId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
}
export type PluginTableCell = string | number | boolean | null | string[] | PluginTableAttachment[];
/** Attachment writes use resource IDs; the host resolves their metadata and ownership. */
export type PluginTableCellInput = string | number | boolean | null | string[];
export interface PluginTableDocument {
    schemaVersion: 1;
    fields: PluginTableField[];
    records: Array<{
        id: string;
        cells: Record<string, PluginTableCell>;
    }>;
    view: {
        filters: Array<{
            fieldId: string;
            operator: "contains" | "eq" | "empty" | "notEmpty";
            value?: string;
        }>;
        sort: {
            fieldId: string;
            direction: "asc" | "desc";
        } | null;
    };
}
export type PluginTableOperation = {
    op: "add_field";
    field: Omit<PluginTableField, "id">;
} | {
    op: "update_field";
    fieldId: string;
    changes: Partial<Omit<PluginTableField, "id">>;
} | {
    op: "remove_field";
    fieldId: string;
} | {
    op: "add_record";
    recordId?: string;
    cells?: Record<string, PluginTableCellInput>;
} | {
    op: "update_record";
    recordId: string;
    cells: Record<string, PluginTableCellInput>;
} | {
    op: "remove_record";
    recordId: string;
};
export interface PluginTableEditInput extends PluginStructuredEditInput {
    operations: PluginTableOperation[];
    /** Required if a schema change converts or removes populated cells. */
    allowDataChanges?: boolean;
}
export interface PluginPosterGradient {
    kind: "linear" | "radial";
    from: string;
    to: string;
    angle: number;
}
export interface PluginPosterPaintGradient extends PluginPosterGradient {
    stops?: Array<{
        offset: number;
        color: string;
        opacity?: number;
    }>;
    coords?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        r1?: number;
        r2?: number;
    };
}
export interface PluginPosterShadow {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
}
export interface PluginPosterCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface PluginPosterBadge {
    background: string;
    padX: number;
    padY: number;
    radius: number;
}
export interface PluginPosterGeometry {
    id: string;
    name: string;
    role?: "title" | "subtitle" | "badge" | "decor";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    visible?: boolean;
    locked?: boolean;
    groupId?: string;
    imagePlaceholder?: boolean;
    flipX?: boolean;
    flipY?: boolean;
    stroke?: string;
    strokeWidth?: number;
    shadow?: PluginPosterShadow;
    gradient?: PluginPosterPaintGradient;
}
export type PluginPosterElement = PluginPosterGeometry & ({
    type: "text";
    text: string;
    sourceText?: string;
    fill: string;
    fontSize: number;
    fontFamily: string;
    fontStyle?: "normal" | "italic";
    underline?: boolean;
    lineHeight?: number;
    charSpacing?: number;
    badge?: PluginPosterBadge;
    fontWeight: "normal" | "bold";
    textAlign: "left" | "center" | "right";
} | {
    type: "rect" | "ellipse";
    fill: string;
    radius?: number;
} | {
    type: "image";
    resourceId: string;
    crop?: PluginPosterCrop;
} | {
    type: "path";
    fill: string;
    path: string;
});
export interface PluginPosterDocument {
    schemaVersion: 1;
    width: number;
    height: number;
    background: string;
    backgroundGradient?: PluginPosterGradient;
    elements: PluginPosterElement[];
    copy?: {
        title: string;
        subtitle: string;
        badge: string;
    };
    templateId?: string;
    platformId?: string;
    sourceMemoId?: string;
    previewResourceId?: string;
}
export type PluginPosterPatch = Partial<Pick<PluginPosterGeometry, "name" | "role" | "visible" | "flipX" | "flipY" | "stroke" | "strokeWidth" | "x" | "y" | "width" | "height" | "rotation" | "opacity">> & {
    shadow?: PluginPosterShadow | null;
    gradient?: PluginPosterPaintGradient | null;
    crop?: PluginPosterCrop | null;
    badge?: PluginPosterBadge | null;
    text?: string;
    fill?: string;
    fontSize?: number;
    fontFamily?: string;
    fontStyle?: "normal" | "italic";
    underline?: boolean;
    lineHeight?: number;
    charSpacing?: number;
    fontWeight?: "normal" | "bold";
    textAlign?: "left" | "center" | "right";
    radius?: number;
    resourceId?: string;
    path?: string;
};
export type PluginPosterTemplate = "editorial" | "bold" | "minimal" | "quote";
export type PluginPosterOperation = {
    op: "add";
    element: PluginPosterElement;
} | {
    op: "remove" | "group" | "ungroup";
    ids: string[];
} | {
    op: "duplicate";
    ids: string[];
    dx?: number;
    dy?: number;
} | {
    op: "reorder";
    ids: string[];
    position: "front" | "back" | "forward" | "backward";
} | {
    op: "align";
    ids: string[];
    alignment: "left" | "center" | "right" | "top" | "middle" | "bottom";
} | {
    op: "lock";
    ids: string[];
    locked: boolean;
} | {
    op: "apply_template";
    template: PluginPosterTemplate;
    heading?: string;
    subtitle?: string;
};
export interface PluginPosterEditInput extends PluginStructuredEditInput {
    edits?: Array<{
        id: string;
        patch: PluginPosterPatch;
    }>;
    operations?: PluginPosterOperation[];
    background?: string;
    backgroundGradient?: PluginPosterGradient | null;
    canvas?: {
        width: number;
        height: number;
        scaleElements?: boolean;
    };
    platform?: string;
}
export interface PluginInfographicDocument {
    schemaVersion: 1;
    syntax: string;
    history?: Array<{
        id: string;
        prompt: string;
        createdAt: string;
        kind: "generated" | "refined" | "clarified" | "failed";
        resultTitle: string;
        response?: string;
        decision?: string;
        template?: string;
        error?: string;
        undoneAt?: string;
    }>;
}
export type PluginInfographicOperation = {
    op: "set_data";
    path: Array<string | number>;
    value: PluginJsonValue;
} | {
    op: "remove_data";
    path: Array<string | number>;
} | {
    op: "insert_data";
    path: Array<string | number>;
    index: number;
    value: PluginJsonValue;
} | {
    op: "set_template";
    template: string;
} | {
    op: "set_theme";
    theme: string;
};
export interface PluginInfographicEditInput extends PluginStructuredEditInput {
    operations: PluginInfographicOperation[];
}
