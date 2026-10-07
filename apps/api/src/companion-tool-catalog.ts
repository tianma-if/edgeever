import { z } from "zod";
import { MCP_TOOLS } from "./mcp-tools";
import { AppError } from "./app-error";

// Exposure policy, not a second tool implementation/schema registry. New MCP
// capabilities must be reviewed rather than silently acquiring user authority.
const allowed = new Set([
  "get_current_user", "search_memos", "list_memos", "get_memo", "create_memo", "create_table_memo", "get_table_records", "add_table_record", "create_diagram_memo", "create_infographic_memo", "get_diagram",
  "update_diagram",
  "import_memos", "update_memo",
  "trash_memos", "restore_memos", "move_memos", "add_tags_to_memos", "remove_tags_from_memos",
  "rename_tag", "delete_tag", "merge_memos", "list_memo_resources", "list_resources",
  "list_memo_revisions", "restore_memo_revision", "move_notebook", "create_notebook", "rename_notebook",
  "get_notebook", "find_notebooks", "resolve_notebook_path", "list_notebooks", "list_tags", "get_workspace_stats",
  "list_note_templates", "get_note_template", "create_note_template", "update_note_template", "delete_note_template",
  "use_note_template", "list_ai_instructions", "get_ai_instruction", "create_ai_instruction", "update_ai_instruction",
  "delete_ai_instruction", "restore_default_ai_instructions",
]);

const OPENAI_INCOMPATIBLE_SCHEMA_KEYS = ["oneOf", "anyOf", "allOf", "const"] as const;

export function assertOpenAiCompatibleToolSchema(schema: unknown, toolName: string) {
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    const record = value as Record<string, unknown>;
    for (const keyword of OPENAI_INCOMPATIBLE_SCHEMA_KEYS) {
      if (keyword in record) {
        throw new Error(`${toolName} ${path} uses ${keyword}, which OpenAI-compatible tool calling rejects.`);
      }
    }
    for (const [key, child] of Object.entries(record)) visit(child, `${path}.${key}`);
  };
  visit(schema, "inputSchema");
}

export const COMPANION_MCP_TOOLS = MCP_TOOLS.filter(tool => allowed.has(tool.name));
for (const tool of COMPANION_MCP_TOOLS) assertOpenAiCompatibleToolSchema(tool.inputSchema, tool.name);
const validators = new Map<string, z.ZodType>();
export function validateCompanionTool(name: string, args: Record<string, unknown>) {
  const definition = COMPANION_MCP_TOOLS.find(tool => tool.name === name);
  if (!definition) throw new AppError("companion_tool_unavailable", "This tool is not available to the companion.", 400);
  let validator = validators.get(name);
  if (!validator) {
    validator = z.fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
    validators.set(name, validator);
  }
  const parsed = validator.safeParse(args);
  if (!parsed.success || JSON.stringify(args).length > 24000) {
    throw new AppError("invalid_params", "Tool arguments are invalid or exceed the preview budget.", 400);
  }
  return { definition, args: parsed.data as Record<string, unknown> };
}
