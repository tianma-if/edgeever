import { ARCHITECTURE_RESOURCE_ICONS, INFOGRAPHIC_NOTE_TEMPLATES, TABLE_FIELD_TYPES } from "@edgeever/shared";

const DIAGRAM_IR_NODE_TYPES = [
  "topic",
  "process",
  "decision",
  "start",
  "end",
  "terminator",
  "client",
  "frontend",
  "service",
  "database",
  "storage",
  "queue",
  "security",
  "external",
  "boundary",
] as const;

const diagramNodeProperties = {
  id: { type: "string", minLength: 1, maxLength: 100 },
  label: { type: "string", maxLength: 500 },
  type: { type: "string", enum: [...DIAGRAM_IR_NODE_TYPES] },
  parentId: { type: "string", minLength: 1, maxLength: 100 },
  resourceIcon: { type: "string", enum: [...ARCHITECTURE_RESOURCE_ICONS] },
};

const diagramNodeSchema = {
  type: "object",
  required: ["id", "label"],
  additionalProperties: false,
  properties: diagramNodeProperties,
};

const diagramEdgeProperties = {
  source: { type: "string", minLength: 1, maxLength: 100 },
  target: { type: "string", minLength: 1, maxLength: 100 },
  label: { type: "string", maxLength: 500 },
  type: { type: "string", enum: ["dependency", "request", "async", "data"] },
  bidirectional: { type: "boolean" },
};

const diagramEdgeSchema = {
  type: "object",
  required: ["source", "target"],
  additionalProperties: false,
  properties: diagramEdgeProperties,
};

const mutableDiagramEdgeSchema = {
  ...diagramEdgeSchema,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 100 },
    ...diagramEdgeProperties,
  },
};

const tableFieldSchema = {
  type: "object",
  required: ["name", "type"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    type: { type: "string", enum: [...TABLE_FIELD_TYPES] },
    options: { type: "array", maxItems: 40, items: { type: "string", minLength: 1, maxLength: 80 } },
  },
};

const infographicLabel = {
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    desc: { type: "string", maxLength: 240 },
  },
};

const infographicChild = {
  type: "object",
  additionalProperties: false,
  required: ["label"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    desc: { type: "string", maxLength: 240 },
    children: { type: "array", maxItems: 8, items: infographicLabel },
  },
};

const infographicDataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    desc: { type: "string", maxLength: 240 },
    values: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 80 },
          value: { type: "number" },
        },
      },
    },
    compares: { type: "array", maxItems: 4, items: infographicChild },
    sequences: { type: "array", maxItems: 12, items: infographicLabel },
    lists: { type: "array", maxItems: 12, items: infographicLabel },
    root: infographicChild,
    nodes: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40 },
          label: { type: "string", minLength: 1, maxLength: 80 },
          desc: { type: "string", maxLength: 240 },
        },
      },
    },
    relations: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: { type: "string", minLength: 1, maxLength: 40 },
          to: { type: "string", minLength: 1, maxLength: 40 },
          direction: { type: "string", maxLength: 20 },
        },
      },
    },
  },
};

const MCP_TOOL_DEFINITIONS = [
  {
    name: "get_current_user",
    description:
      "Identify the EdgeEver user and personal workspace authorized by the current session or API token. Use this before imports when the destination account must be confirmed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "search_memos",
    description: "Search active EdgeEver memos by text, tag, notebook, time range, pin state, or resource presence. query is optional. For recently created or added notes, pass createdAfter and omit query; do not put this week/最近/新增 in query. Time bounds accept YYYY-MM-DD or ISO date-time.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        notebookId: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        createdAfter: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) or date-time. Date-only means 00:00:00.000Z." },
        createdBefore: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) or date-time. Date-only means 23:59:59.999Z." },
        updatedAfter: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) or date-time. Date-only means 00:00:00.000Z." },
        updatedBefore: { type: "string", description: "ISO 8601 date (YYYY-MM-DD) or date-time. Date-only means 23:59:59.999Z." },
        isPinned: { type: "boolean" },
        hasResources: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "list_memos",
    description: "List EdgeEver memos with pagination. Use includeContent when full Markdown is needed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 },
        includeContent: { type: "boolean" },
        includeDeleted: { type: "boolean" },
      },
    },
  },
  {
    name: "get_memo",
    description: "Read a memo with Markdown content.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        includeDeleted: { type: "boolean" },
      },
    },
  },
  {
    name: "create_memo",
    description: "Create a memo in a notebook.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        title: { type: "string" },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "get_table_records",
    description: "Read the fields and a page of records from one structured table memo. Use field IDs and record IDs for subsequent writes. Returns the memo revision for optimistic concurrency.",
    inputSchema: {
      type: "object", required: ["memoId"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        recordId: { type: "string", minLength: 1 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "create_table_memo",
    description: "Create an editable structured table memo from a field plan. Infer field names and types from the user's request, then pass explicit fields. The table starts empty; add_table_record can populate it. Select fields require options.",
    inputSchema: {
      type: "object", required: ["notebookId", "title", "fields"], additionalProperties: false,
      properties: {
        notebookId: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 160 },
        tags: { type: "array", maxItems: 100, items: { type: "string" } },
        fields: { type: "array", minItems: 1, maxItems: 40, items: tableFieldSchema },
      },
    },
  },
  {
    name: "update_table_schema",
    description: "Apply field changes to one structured table memo. First use dryRun to preview changedCellCount and removedAttachmentCount. If existing cell values would change, pass allowDataChanges=true to execute. Operations run in order and use stable field IDs from get_table_records.",
    inputSchema: {
      type: "object", required: ["memoId", "expectedRevision", "operations"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
        dryRun: { type: "boolean" },
        allowDataChanges: { type: "boolean" },
        operations: {
          type: "array", minItems: 1, maxItems: 40,
          items: {
            type: "object", required: ["op"], additionalProperties: false,
            properties: {
              op: { type: "string", enum: ["add_field", "update_field", "remove_field"] },
              fieldId: { type: "string", minLength: 1 },
              field: tableFieldSchema,
              changes: {
                type: "object", minProperties: 1, additionalProperties: false,
                properties: tableFieldSchema.properties,
              },
            },
          },
        },
      },
    },
  },
  {
    name: "add_table_record",
    description: "Add one record to an existing structured table memo. cells maps field IDs to values; attachment fields accept arrays of resource IDs already uploaded to this memo. Pass the revision returned by get_table_records.",
    inputSchema: {
      type: "object", required: ["memoId", "expectedRevision", "cells"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
        cells: { type: "object", additionalProperties: true },
      },
    },
  },
  {
    name: "update_table_record",
    description: "Update selected cells of one record in a structured table memo. Other cells remain unchanged. Attachment fields accept arrays of resource IDs already uploaded to this memo.",
    inputSchema: {
      type: "object", required: ["memoId", "recordId", "expectedRevision", "cells"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        recordId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
        cells: { type: "object", minProperties: 1, additionalProperties: true },
      },
    },
  },
  {
    name: "delete_table_record",
    description: "Delete one record from a structured table memo by record ID. This also releases attachments used only by the removed record.",
    inputSchema: {
      type: "object", required: ["memoId", "recordId", "expectedRevision"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        recordId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
      },
    },
  },
  {
    name: "create_infographic_memo",
    description:
      "Create an AntV infographic note (信息图). Use this for 信息图, infographic, 占比, 构成, 饼图, 柱状图, 折线图, 对比, 四象限, 时间线, and a process infographic. Do not use create_diagram_memo, create_memo, or a mind map. Use chart-pie-donut-plain-text with data.values for a share or 占比; chart-column-simple for columns; chart-line-plain-text for a trend; compare-binary-horizontal-badge-card-vs for two subjects with matched children; compare-quadrant-quarter-simple-card for four quadrants; sequence-timeline-rounded-rect-node for a timeline; sequence-steps-simple for steps; list-grid-simple for a parallel list; hierarchy-tree-tech-style-capsule-item for a tree; relation-network-simple-circle-node for a network. Fill only the data array that matches the template. data.title is the note title. If the user did not supply the figures, say in data.desc that the values are illustrative and are not an official disclosure. 思维导图, 流程图, and 架构图 still use create_diagram_memo.",
    inputSchema: {
      type: "object",
      required: ["notebookId", "template", "data"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string", minLength: 1 },
        title: { type: "string", maxLength: 160 },
        template: { type: "string", enum: [...INFOGRAPHIC_NOTE_TEMPLATES] },
        data: infographicDataSchema,
        tags: { type: "array", maxItems: 100, items: { type: "string" } },
      },
    },
  },
  {
    name: "create_diagram_memo",
    description:
      "Create an editable visual diagram memo from a semantic graph; EdgeEver generates node sizes, coordinates, edge IDs, and a deterministic layout. Mind maps and flowcharts always start with the default plain theme; any supplied theme is ignored for those kinds. For mind maps, omit node type and use parentId for hierarchy. Flowchart node types are process, decision, start, or end. Architecture node types are client, frontend, service, database, storage, queue, security, external, or boundary; boundary nodes contain components through those components' parentId and cannot be edge endpoints. Give every architecture boundary at least one contained component, or omit the boundary rather than creating an empty section.",
    inputSchema: {
      type: "object",
      required: ["notebookId", "kind", "nodes"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string", minLength: 1 },
        title: { type: "string", maxLength: 160 },
        kind: { type: "string", enum: ["mind-map", "flowchart", "architecture"] },
        theme: { type: "string", description: "Color scheme for architecture diagrams. Mind maps and flowcharts always start with the default plain theme.", enum: ["plain", "brand", "sun", "wa", "island", "rose", "mint", "cosmos", "tea", "naive", "macaron", "ocean", "ink", "classic", "paper"] },
        structure: { type: "string", enum: ["map", "line", "capsule", "box", "circle", "ellipse", "hexagon", "logic", "tree", "brace", "org", "timeline", "fishbone"] },
        layout: {
          type: "object",
          additionalProperties: false,
          properties: {
            direction: { type: "string", enum: ["left-to-right", "top-to-bottom"] },
          },
        },
        tags: { type: "array", maxItems: 100, items: { type: "string" } },
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: diagramNodeSchema,
        },
        edges: {
          type: "array",
          maxItems: 400,
          items: diagramEdgeSchema,
        },
      },
    },
  },
  {
    name: "get_poster",
    description: "Read an editable poster's canvas, element IDs, text, colors and geometry. Read before update_poster; never decode or replace poster Markdown.",
    inputSchema: { type: "object", required: ["memoId"], additionalProperties: false, properties: { memoId: { type: "string", minLength: 1 } } },
  },
  {
    name: "update_poster",
    description: "Edit an existing poster's text, colors, typography and element positions. Preserve unmentioned elements and locked elements. Read get_poster first and pass its expectedRevision. Use dryRun to preview. After changes the editor regenerates the preview image.",
    inputSchema: {
      type: "object", required: ["memoId", "expectedRevision"], additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 }, expectedRevision: { type: "integer", minimum: 0 }, dryRun: { type: "boolean" },
        background: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        backgroundGradient: { type: ["object", "null"], additionalProperties: false, required: ["kind", "from", "to"], properties: {
          kind: { type: "string", enum: ["linear", "radial"] }, from: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, to: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, angle: { type: "number", minimum: -360, maximum: 360 },
        } },
        edits: { type: "array", maxItems: 100, items: {
          type: "object", required: ["id", "patch"], additionalProperties: false,
          properties: { id: { type: "string", minLength: 1 }, patch: {
            type: "object", additionalProperties: false, properties: {
              text: { type: "string", maxLength: 8000 }, fill: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
              fontSize: { type: "number", minimum: 4, maximum: 8192 }, fontWeight: { type: "string", enum: ["normal", "bold"] }, textAlign: { type: "string", enum: ["left", "center", "right"] },
              x: { type: "number", minimum: -8192, maximum: 8192 }, y: { type: "number", minimum: -8192, maximum: 8192 },
              width: { type: "number", minimum: 1, maximum: 8192 }, height: { type: "number", minimum: 1, maximum: 8192 },
              rotation: { type: "number", minimum: -360, maximum: 360 }, opacity: { type: "number", minimum: 0, maximum: 1 },
            },
          } },
        } },
      },
    },
  },
  {
    name: "get_diagram",
    description:
      "Read an editable diagram as a semantic graph. Coordinates and dimensions are omitted by default; set includeLayout only for an explicit visual-layout task.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        includeLayout: { type: "boolean", description: "Include node coordinates and dimensions. Defaults to false." },
      },
    },
  },
  {
    name: "update_diagram",
    description:
      "Apply validated semantic operations to an existing diagram while preserving unaffected authored layout. Use expectedRevision to prevent concurrent overwrites. Set reflow to all only when the user explicitly wants a complete automatic layout.",
    inputSchema: {
      type: "object",
      required: ["memoId", "expectedRevision", "operations"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string", minLength: 1 },
        expectedRevision: { type: "integer", minimum: 0 },
        dryRun: { type: "boolean" },
        reflow: { type: "string", enum: ["preserve", "all"] },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["op"],
            additionalProperties: false,
            properties: {
              op: {
                type: "string",
                enum: ["add_node", "update_node", "remove_node", "add_edge", "update_edge", "remove_edge"],
              },
              node: diagramNodeSchema,
              nodeId: { type: "string", minLength: 1 },
              edge: mutableDiagramEdgeSchema,
              edgeId: { type: "string", minLength: 1 },
              changes: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string", maxLength: 500 },
                  type: { type: "string", enum: [...DIAGRAM_IR_NODE_TYPES] },
                  parentId: { type: "string", maxLength: 100 },
                  resourceIcon: { type: "string", enum: [...ARCHITECTURE_RESOURCE_ICONS] },
                  source: { type: "string", minLength: 1, maxLength: 100 },
                  target: { type: "string", minLength: 1, maxLength: 100 },
                  bidirectional: { type: "boolean" },
                },
              },
              cascade: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  {
    name: "import_memos",
    description:
      "Import up to 25 memos from an external service with database-backed idempotency. Reusing the same source and externalId returns skipped instead of creating a duplicate. Results are reported per item.",
    inputSchema: {
      type: "object",
      required: ["source", "notebookId", "items"],
      additionalProperties: false,
      properties: {
        source: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z0-9._-]+$",
          description: "Stable source identifier such as flomo, notion, memos, or evernote.",
        },
        notebookId: { type: "string", description: "Destination notebook for every item in this batch." },
        dryRun: { type: "boolean", description: "Validate and report existing items without creating memos." },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: {
            type: "object",
            required: ["externalId"],
            additionalProperties: false,
            properties: {
              externalId: {
                type: "string",
                minLength: 1,
                maxLength: 512,
                description: "Stable ID from the source system. It is the idempotency key within source and workspace.",
              },
              title: { type: "string", maxLength: 160 },
              contentMarkdown: { type: "string" },
              tags: { type: "array", maxItems: 100, items: { type: "string" } },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  },
  {
    name: "update_memo",
    description: "Update memo title, Markdown, tags, notebook, or pinned state.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        title: { type: "string" },
        isPinned: { type: "boolean" },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notebookId: { type: "string" },
        expectedRevision: { type: "integer", minimum: 0 },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "trash_memos",
    description: "Move one or more active memos to trash. Use dryRun to preview affected memos.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "restore_memos",
    description: "Restore one or more trashed memos. If the original notebook is gone, memos are restored to the default inbox.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "move_memos",
    description: "Move one or more active memos to another notebook. Use dryRun to preview affected memos.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "notebookId"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        notebookId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "add_tags_to_memos",
    description: "Add tags to one or more active memos. Use dryRun to preview changed tags.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "tags"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        tags: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "remove_tags_from_memos",
    description: "Remove tags from one or more active memos. Use dryRun to preview changed tags.",
    inputSchema: {
      type: "object",
      required: ["memoIds", "tags"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        tags: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "rename_tag",
    description: "Rename a tag across all active memos. This merges into an existing tag with the same normalized name.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      additionalProperties: false,
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "delete_tag",
    description: "Remove a tag from all active memos.",
    inputSchema: {
      type: "object",
      required: ["tag"],
      additionalProperties: false,
      properties: {
        tag: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "merge_memos",
    description: "Merge multiple active memos into a new memo and soft-delete the sources.",
    inputSchema: {
      type: "object",
      required: ["memoIds"],
      additionalProperties: false,
      properties: {
        memoIds: { type: "array", minItems: 2, maxItems: 50, items: { type: "string" } },
        notebookId: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "upload_memo_image",
    description:
      "Upload a base64-encoded image resource to a memo and return Markdown that can be inserted into memo content. Images are stored as provided; server-side compression is disabled to avoid Cloudflare Images quota usage.",
    inputSchema: {
      type: "object",
      required: ["memoId", "mimeType", "dataBase64"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        filename: { type: "string" },
        mimeType: { type: "string", enum: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] },
        dataBase64: { type: "string" },
        alt: { type: "string" },
      },
    },
  },
  {
    name: "upload_memo_attachment",
    description: "Upload a base64-encoded attachment resource to a memo and return Markdown link text that can be inserted into memo content.",
    inputSchema: {
      type: "object",
      required: ["memoId", "filename", "mimeType", "dataBase64"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        filename: { type: "string" },
        mimeType: { type: "string" },
        dataBase64: { type: "string" },
        label: { type: "string" },
      },
    },
  },
  {
    name: "list_memo_resources",
    description: "List active resources attached to a memo.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
      },
    },
  },
  {
    name: "list_resources",
    description: "List active workspace resources with storage summary.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: "list_memo_revisions",
    description: "List revision history for a memo.",
    inputSchema: {
      type: "object",
      required: ["memoId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "restore_memo_revision",
    description: "Restore a memo to a previous revision. Use dryRun to preview the target revision.",
    inputSchema: {
      type: "object",
      required: ["memoId", "revisionId"],
      additionalProperties: false,
      properties: {
        memoId: { type: "string" },
        revisionId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "move_notebook",
    description: "Move a notebook under another notebook or root and update its sort order.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string" },
        parentId: { type: ["string", "null"] },
        sortOrder: { type: "integer" },
      },
    },
  },
  {
    name: "delete_notebook",
    description: "Soft-delete a notebook and all its empty descendants. Refuses deletion if any active note exists in the subtree; never deletes notes. The default inbox is protected. Resolve paths with resolve_notebook_path first and use the exact notebookId. Use dryRun to preview affected notebook IDs without changes. Concurrent changes require a fresh preview and retry.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string", minLength: 1, description: "Exact EdgeEver notebook ID obtained from a unique path resolution or lookup." },
        dryRun: { type: "boolean", description: "Preview the empty subtree without deleting it." },
      },
    },
  },
  {
    name: "create_notebook",
    description: "Create a notebook at the root or under another notebook.",
    inputSchema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        parentId: { type: ["string", "null"] },
        sortOrder: { type: "integer" },
      },
    },
  },
  {
    name: "rename_notebook",
    description: "Rename an active notebook in the authenticated user's workspace.",
    inputSchema: {
      type: "object",
      required: ["notebookId", "name"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string", description: "The exact EdgeEver notebook ID." },
        name: { type: "string", minLength: 1, maxLength: 80 },
      },
    },
  },
  {
    name: "get_notebook",
    description: "Get one active notebook by ID from the authenticated user's workspace.",
    inputSchema: {
      type: "object",
      required: ["notebookId"],
      additionalProperties: false,
      properties: {
        notebookId: { type: "string", description: "The exact EdgeEver notebook ID." },
      },
    },
  },
  {
    name: "find_notebooks",
    description: "Find active notebooks by name, optionally restricted to a parent notebook or the workspace root.",
    inputSchema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, description: "Full or partial notebook name, matched case-insensitively." },
        parentId: {
          type: ["string", "null"],
          description: "Parent notebook ID. Pass null to search only root notebooks; omit to search all levels.",
        },
        exact: { type: "boolean", description: "Require an exact name match. Defaults to false." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "resolve_notebook_path",
    description:
      "Resolve a slash-separated notebook path such as 'Imports/Flomo' to one exact notebook. Returns a diagnostic result instead of guessing when a segment is missing or ambiguous.",
    inputSchema: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, description: "Slash-separated notebook names from the workspace root." },
      },
    },
  },
  {
    name: "list_notebooks",
    description:
      "List active notebooks in the authenticated user's workspace. Every returned notebook is owned by that workspace; notebooks from other users are never returned.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "list_tags",
    description: "List tags and memo counts.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "get_workspace_stats",
    description: "Get notebook, memo, tag, and resource counts for workspace diagnostics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "list_note_templates",
    description: "List reusable note templates in the authenticated user's workspace, including their Markdown content and tags.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "get_note_template",
    description: "Get one reusable note template by its exact EdgeEver template ID.",
    inputSchema: {
      type: "object",
      required: ["templateId"],
      additionalProperties: false,
      properties: {
        templateId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "create_note_template",
    description: "Create a reusable note template from supplied Markdown or an existing memo in the authenticated user's workspace.",
    inputSchema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 500 },
        memoId: { type: "string", minLength: 1, description: "Existing memo to copy into the template." },
        title: { type: ["string", "null"], maxLength: 160 },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "update_note_template",
    description: "Update the name, description, title, Markdown content, or tags of a reusable note template.",
    inputSchema: {
      type: "object",
      required: ["templateId"],
      additionalProperties: false,
      properties: {
        templateId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: ["string", "null"], maxLength: 500 },
        title: { type: ["string", "null"], maxLength: 160 },
        contentMarkdown: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "delete_note_template",
    description: "Permanently delete a reusable note template from the authenticated user's workspace.",
    inputSchema: {
      type: "object",
      required: ["templateId"],
      additionalProperties: false,
      properties: {
        templateId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "use_note_template",
    description: "Create a new memo from a reusable note template in the selected notebook.",
    inputSchema: {
      type: "object",
      required: ["templateId", "notebookId"],
      additionalProperties: false,
      properties: {
        templateId: { type: "string", minLength: 1 },
        notebookId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "list_ai_instructions",
    description: "List reusable AI instructions in the authenticated user's workspace, including built-in and custom entries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        locale: { type: "string", description: "Optional locale such as en-US or zh-CN for unmodified built-in instructions." },
      },
    },
  },
  {
    name: "get_ai_instruction",
    description: "Get one reusable AI instruction by its exact EdgeEver instruction ID.",
    inputSchema: {
      type: "object",
      required: ["instructionId"],
      additionalProperties: false,
      properties: {
        instructionId: { type: "string", minLength: 1 },
        locale: { type: "string" },
      },
    },
  },
  {
    name: "create_ai_instruction",
    description: "Create a custom reusable AI instruction in the authenticated user's workspace.",
    inputSchema: {
      type: "object",
      required: ["name", "instruction"],
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", maxLength: 200 },
        instruction: { type: "string", minLength: 1, maxLength: 2000 },
        parameterKind: { type: "string", enum: ["none", "target-language", "tone"], default: "none" },
        resultMode: { type: "string", enum: ["append", "replace", "both"], default: "both" },
        locale: { type: "string" },
      },
    },
  },
  {
    name: "update_ai_instruction",
    description: "Update the text or execution behavior of a built-in or custom reusable AI instruction.",
    inputSchema: {
      type: "object",
      required: ["instructionId"],
      additionalProperties: false,
      properties: {
        instructionId: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: ["string", "null"], maxLength: 200 },
        instruction: { type: "string", minLength: 1, maxLength: 2000 },
        parameterKind: { type: "string", enum: ["none", "target-language", "tone"] },
        resultMode: { type: "string", enum: ["append", "replace", "both"] },
        locale: { type: "string" },
      },
    },
  },
  {
    name: "delete_ai_instruction",
    description: "Delete a reusable AI instruction. Deleted built-in instructions can be restored later.",
    inputSchema: {
      type: "object",
      required: ["instructionId"],
      additionalProperties: false,
      properties: {
        instructionId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "restore_default_ai_instructions",
    description: "Restore missing built-in AI instructions without overwriting edited instructions or custom entries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        locale: { type: "string" },
      },
    },
  },
];

const READ_ONLY_MCP_TOOLS = new Set([
  "get_current_user",
  "search_memos",
  "list_memos",
  "get_memo",
  "get_table_records",
  "get_diagram",
  "get_poster",
  "list_memo_resources",
  "list_resources",
  "list_memo_revisions",
  "get_notebook",
  "find_notebooks",
  "resolve_notebook_path",
  "list_notebooks",
  "list_tags",
  "get_workspace_stats",
  "list_note_templates",
  "get_note_template",
  "list_ai_instructions",
  "get_ai_instruction",
]);
const NON_DESTRUCTIVE_MCP_TOOLS = new Set([
  "create_memo",
  "create_table_memo",
  "create_diagram_memo",
  "create_infographic_memo",
  "import_memos",
  "restore_memos",
  "move_memos",
  "add_tags_to_memos",
  "upload_memo_image",
  "upload_memo_attachment",
  "move_notebook",
  "create_notebook",
  "rename_notebook",
  "create_note_template",
  "update_note_template",
  "use_note_template",
  "create_ai_instruction",
  "update_ai_instruction",
  "restore_default_ai_instructions",
]);
const IDEMPOTENT_MCP_TOOLS = new Set([
  "delete_notebook",
  "restore_memos",
  "move_memos",
  "add_tags_to_memos",
  "remove_tags_from_memos",
  "import_memos",
  "move_notebook",
  "rename_notebook",
  "update_note_template",
  "update_ai_instruction",
  "restore_default_ai_instructions",
]);

export const MCP_TOOLS = MCP_TOOL_DEFINITIONS.map((tool) => {
  const readOnly = READ_ONLY_MCP_TOOLS.has(tool.name);
  return {
    ...tool,
    title: tool.name.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
    outputSchema: { type: "object" },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: readOnly ? false : !NON_DESTRUCTIVE_MCP_TOOLS.has(tool.name),
      idempotentHint: readOnly || IDEMPOTENT_MCP_TOOLS.has(tool.name),
      openWorldHint: false,
    },
  };
});
