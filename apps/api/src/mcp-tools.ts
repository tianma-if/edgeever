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
    description: "Search active EdgeEver memos by text, tag, notebook, time range, pin state, or resource presence.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        notebookId: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        createdAfter: { type: "string", format: "date-time" },
        createdBefore: { type: "string", format: "date-time" },
        updatedAfter: { type: "string", format: "date-time" },
        updatedBefore: { type: "string", format: "date-time" },
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
      anyOf: [{ required: ["memoId"] }, { required: ["contentMarkdown"] }],
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
      anyOf: [
        { required: ["name"] },
        { required: ["description"] },
        { required: ["title"] },
        { required: ["contentMarkdown"] },
        { required: ["tags"] },
      ],
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
      anyOf: [
        { required: ["name"] },
        { required: ["description"] },
        { required: ["instruction"] },
        { required: ["parameterKind"] },
        { required: ["resultMode"] },
      ],
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
