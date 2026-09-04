import { z } from "zod";
import { MCP_TOOLS } from "./mcp-tools";
import { AppError } from "./app-error";

// Exposure policy, not a second tool implementation/schema registry. New MCP
// capabilities must be reviewed rather than silently acquiring user authority.
const allowed = new Set([
  "get_current_user", "search_memos", "list_memos", "get_memo", "create_memo", "import_memos", "update_memo",
  "trash_memos", "restore_memos", "move_memos", "add_tags_to_memos", "remove_tags_from_memos",
  "rename_tag", "delete_tag", "merge_memos", "list_memo_resources", "list_resources",
  "list_memo_revisions", "restore_memo_revision", "move_notebook", "create_notebook", "rename_notebook",
  "get_notebook", "find_notebooks", "resolve_notebook_path", "list_notebooks", "list_tags", "get_workspace_stats",
]);
export const COMPANION_MCP_TOOLS = MCP_TOOLS.filter(tool => allowed.has(tool.name));
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
