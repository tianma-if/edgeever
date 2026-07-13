export type TiptapTextNode = {
  type: "text";
  text: string;
};

export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<TiptapNode | TiptapTextNode>;
};

export type TiptapDoc = {
  type: "doc";
  content: TiptapNode[];
};

export const DEFAULT_MEMO_TITLE = "无标题笔记";

export const emptyDoc = (): TiptapDoc => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const markdownToDoc = (markdown: string): TiptapDoc => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: TiptapNode[] = [];

  for (let index = 0; index < lines.length; ) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const fence = /^```([^\s`]*)\s*$/.exec(lines[index].trim());

    if (fence) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && lines[index].trim() !== "```") {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      content.push({
        type: "codeBlock",
        attrs: { language: fence[1] || "plaintext" },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    const blockLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      blockLines.push(lines[index]);
      index += 1;
    }

    const block = blockLines.join("\n").trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(block);
    const image = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]+)")?\)$/.exec(block);

    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: [{ type: "text", text: heading[2] }],
      });
      continue;
    }

    if (image) {
      content.push({
        type: "image",
        attrs: {
          src: image[2],
          alt: image[1] || null,
          title: image[3] || null,
        },
      });
      continue;
    }

    if (/^-{3,}$/.test(block)) {
      content.push({ type: "horizontalRule" });
      continue;
    }

    content.push({
      type: "paragraph",
      content: [{ type: "text", text: block }],
    });
  }

  if (content.length === 0) {
    return emptyDoc();
  }

  return { type: "doc", content };
};

export const docToText = (doc: unknown): string => {
  const pieces: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const current = node as { type?: unknown; text?: unknown; attrs?: Record<string, unknown>; content?: unknown };

    if (typeof current.text === "string") {
      pieces.push(current.text);
    }

    if (current.type === "image") {
      const label =
        getStringAttr(current.attrs, "alt") ||
        getStringAttr(current.attrs, "title") ||
        getStringAttr(current.attrs, "filename");

      if (label) {
        pieces.push(label);
      }
    }

    if (Array.isArray(current.content)) {
      for (const child of current.content) {
        walk(child);
      }
    }
  };

  walk(doc);

  return pieces.join(" ").replace(/\s+/g, " ").trim();
};

export const docToMarkdown = (doc: unknown): string => {
  if (!doc || typeof doc !== "object") {
    return "";
  }

  const root = doc as { content?: unknown };

  if (!Array.isArray(root.content)) {
    return "";
  }

  return root.content
    .map((node) => blockToMarkdown(node))
    .filter(Boolean)
    .join("\n\n");
};

const blockToMarkdown = (node: unknown): string => {
  if (!node || typeof node !== "object") {
    return "";
  }

  const current = node as {
    type?: unknown;
    attrs?: Record<string, unknown>;
    content?: unknown;
    text?: unknown;
  };

  if (current.type === "heading") {
    const level = typeof current.attrs?.level === "number" ? current.attrs.level : 1;
    const text = inlineToMarkdown(current.content);
    return text ? `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${text}` : "";
  }

  if (current.type === "image") {
    return imageToMarkdown(current.attrs);
  }

  if (current.type === "horizontalRule") {
    return "---";
  }

  if (current.type === "bulletList" && Array.isArray(current.content)) {
    return current.content
      .map((item) => inlineToMarkdown((item as { content?: unknown })?.content))
      .filter(Boolean)
      .map((item) => `- ${item.replace(/\n/g, "\n  ")}`)
      .join("\n");
  }

  if (current.type === "orderedList" && Array.isArray(current.content)) {
    return current.content
      .map((item, index) => {
        const text = inlineToMarkdown((item as { content?: unknown })?.content);
        return text ? `${index + 1}. ${text.replace(/\n/g, "\n   ")}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (current.type === "blockquote") {
    const text = inlineToMarkdown(current.content);
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (current.type === "codeBlock") {
    const language = getStringAttr(current.attrs, "language");
    const languageSuffix = language && language !== "plaintext" ? language : "";
    const code = contentToPlainText(current.content);
    return `\`\`\`${languageSuffix}\n${code}\n\`\`\``;
  }

  return inlineToMarkdown(current.content);
};

const contentToPlainText = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((node) => {
      if (!node || typeof node !== "object") {
        return "";
      }

      const current = node as { type?: unknown; text?: unknown; content?: unknown };

      if (typeof current.text === "string") {
        return current.text;
      }

      if (current.type === "hardBreak") {
        return "\n";
      }

      return contentToPlainText(current.content);
    })
    .join("");
};

const inlineToMarkdown = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((node) => {
      if (!node || typeof node !== "object") {
        return "";
      }

      const current = node as {
        type?: unknown;
        text?: unknown;
        attrs?: Record<string, unknown>;
        content?: unknown;
      };

      if (typeof current.text === "string") {
        return current.text;
      }

      if (current.type === "hardBreak") {
        return "\n";
      }

      if (current.type === "image") {
        return imageToMarkdown(current.attrs);
      }

      return inlineToMarkdown(current.content);
    })
    .join("");
};

const imageToMarkdown = (attrs: Record<string, unknown> | undefined): string => {
  const src = getStringAttr(attrs, "src");

  if (!src) {
    return "";
  }

  const alt = getStringAttr(attrs, "alt");
  const title = getStringAttr(attrs, "title");
  const titleSuffix = title ? ` "${title.replace(/"/g, '\\"')}"` : "";

  return `![${alt.replace(/\]/g, "\\]")}](${src}${titleSuffix})`;
};

const getStringAttr = (attrs: Record<string, unknown> | undefined, key: string) => {
  const value = attrs?.[key];
  return typeof value === "string" ? value.trim() : "";
};

export const createExcerpt = (text: string, maxLength = 30): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

export const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
        .map((tag) => tag.replace(/^#/, ""))
    )
  ).slice(0, 24);
};
