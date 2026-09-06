import { mergeAttributes, Node } from "@tiptap/core";

export const PLUGIN_EMBED_NODE_TYPE = "edgeeverPluginEmbed" as const;
export const PLUGIN_EMBED_MARKDOWN_LANGUAGE = "edgeever-plugin-embed" as const;

export type PluginEmbedAttributes = {
  id: string;
  pluginId: string;
  type: string;
  resourceId: string;
  previewResourceId: string;
  title: string;
  dataJson: string;
};

const normalizeString = (value: unknown, limit = 500) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export const normalizePluginEmbedAttributes = (value: unknown): PluginEmbedAttributes | null => {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = normalizeString(input.id, 160);
  const pluginId = normalizeString(input.pluginId, 160);
  const type = normalizeString(input.type, 120);
  const resourceId = normalizeString(input.resourceId, 200);
  if (!id || !pluginId || !type || !resourceId) return null;
  const dataJson = typeof input.dataJson === "string" ? input.dataJson : "null";
  try {
    JSON.parse(dataJson);
  } catch {
    return null;
  }
  return {
    id,
    pluginId,
    type,
    resourceId,
    previewResourceId: normalizeString(input.previewResourceId, 200),
    title: normalizeString(input.title, 500),
    dataJson,
  };
};

export const pluginEmbedToMarkdown = (attributes: PluginEmbedAttributes) =>
  `\`\`\`${PLUGIN_EMBED_MARKDOWN_LANGUAGE}\n${JSON.stringify(attributes)}\n\`\`\``;

const FENCE_PATTERN = /^```edgeever-plugin-embed[ \t]*\n([^\n]+)\n```(?:\n|$)/;

export const PluginEmbed = Node.create({
  name: PLUGIN_EMBED_NODE_TYPE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: "" },
      pluginId: { default: "" },
      type: { default: "" },
      resourceId: { default: "" },
      previewResourceId: { default: "" },
      title: { default: "" },
      dataJson: { default: "null" },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="edgeever-plugin-embed"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const title = typeof HTMLAttributes.title === "string" && HTMLAttributes.title
      ? HTMLAttributes.title
      : "Plugin embed";
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-type": "edgeever-plugin-embed",
        class: "edgeever-plugin-embed",
        contenteditable: "false",
      }),
      ["figcaption", {}, title],
    ];
  },

  parseMarkdown: (token) => ({
    type: PLUGIN_EMBED_NODE_TYPE,
    attrs: token.attrs,
  }),

  renderMarkdown: (node) => {
    const attributes = normalizePluginEmbedAttributes(node.attrs);
    return attributes ? pluginEmbedToMarkdown(attributes) : "";
  },

  markdownTokenizer: {
    name: PLUGIN_EMBED_NODE_TYPE,
    level: "block",
    start(source: string) {
      return source.indexOf(`\`\`\`${PLUGIN_EMBED_MARKDOWN_LANGUAGE}`);
    },
    tokenize(source: string) {
      const match = FENCE_PATTERN.exec(source);
      if (!match) return undefined;
      try {
        const attrs = normalizePluginEmbedAttributes(JSON.parse(match[1]));
        if (!attrs) return undefined;
        return { type: PLUGIN_EMBED_NODE_TYPE, raw: match[0], attrs };
      } catch {
        return undefined;
      }
    },
  },
});
