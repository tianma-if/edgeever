export type TiptapMark = {
  type: "bold" | "italic" | "code" | "strike" | "link";
  attrs?: Record<string, unknown>;
};

export type TiptapTextNode = {
  type: "text";
  text: string;
  marks?: TiptapMark[];
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

const parseInlineMarkdown = (text: string): TiptapTextNode[] => {
  if (!text) {
    return [];
  }

  const nodes: TiptapTextNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Try to find the earliest inline markdown match
    const boldItalicMatch = remaining.match(/^\*\*\*([\s\S]*?)\*\*\*/);
    const boldMatch = remaining.match(/^\*\*([\s\S]*?)\*\*/);
    const italicMatch = remaining.match(/^\*([^*].*?)\*/);
    const boldUMatch = remaining.match(/^__([\s\S]*?)__/);
    const italicUMatch = remaining.match(/^_([^_].*?)_/);
    const strikeMatch = remaining.match(/^~~([\s\S]*?)~~/);
    const codeMatch = remaining.match(/^`([^`]+)`/);
    const imageMatch = remaining.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]+)")?\)/);
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);

    // Find the earliest match (smallest index is 0 since we use ^ anchors)
    // Prioritize longer markers first to avoid * matching inside **
    type MatchResult = { type: string; match: RegExpMatchArray; length: number };
    const matches: MatchResult[] = [];

    if (boldItalicMatch) matches.push({ type: "boldItalic", match: boldItalicMatch, length: boldItalicMatch[0].length });
    if (boldMatch) matches.push({ type: "bold", match: boldMatch, length: boldMatch[0].length });
    if (italicMatch) matches.push({ type: "italic", match: italicMatch, length: italicMatch[0].length });
    if (boldUMatch) matches.push({ type: "bold", match: boldUMatch, length: boldUMatch[0].length });
    if (italicUMatch) matches.push({ type: "italic", match: italicUMatch, length: italicUMatch[0].length });
    if (strikeMatch) matches.push({ type: "strike", match: strikeMatch, length: strikeMatch[0].length });
    if (codeMatch) matches.push({ type: "code", match: codeMatch, length: codeMatch[0].length });
    if (imageMatch) matches.push({ type: "image", match: imageMatch, length: imageMatch[0].length });
    if (linkMatch) matches.push({ type: "link", match: linkMatch, length: linkMatch[0].length });

    // Sort by match length descending (longer patterns first, e.g., *** before ** before *)
    matches.sort((a, b) => b.length - a.length);

    if (matches.length > 0) {
      const earliest = matches[0];
      const match = earliest.match;

      // If match doesn't start at position 0, add plain text prefix
      if (match.index! > 0) {
        nodes.push({ type: "text", text: remaining.slice(0, match.index) });
      }

      switch (earliest.type) {
        case "boldItalic": {
          const inner = parseInlineMarkdown(match[1]!);
          for (const n of inner) {
            nodes.push({
              ...n,
              marks: [...(n.marks || []), { type: "bold" }, { type: "italic" }],
            });
          }
          break;
        }
        case "bold": {
          const inner = parseInlineMarkdown(match[1]!);
          for (const n of inner) {
            nodes.push({ ...n, marks: [...(n.marks || []), { type: "bold" }] });
          }
          break;
        }
        case "italic":
          nodes.push({ type: "text", text: match[1]!, marks: [{ type: "italic" }] });
          break;
        case "strike":
          nodes.push({ type: "text", text: match[1]!, marks: [{ type: "strike" }] });
          break;
        case "code":
          nodes.push({ type: "text", text: match[1]!, marks: [{ type: "code" }] });
          break;
        case "image":
          nodes.push({
            type: "text",
            text: match[1] || "",
            marks: [{ type: "link", attrs: { href: match[2]!, title: match[3] || null } }],
          });
          break;
        case "link":
          nodes.push({ type: "text", text: match[1]!, marks: [{ type: "link", attrs: { href: match[2]! } }] });
          break;
      }

      remaining = remaining.slice(match.index! + match[0].length);
    } else {
      // No match found, consume one character
      nodes.push({ type: "text", text: remaining[0]! });
      remaining = remaining.slice(1);
    }
  }

  return nodes;
};

const isListItem = (line: string): false | "bullet" | "ordered" => {
  if (/^\s*[-*+]\s+/.test(line)) return "bullet";
  if (/^\s*\d+\.\s+/.test(line)) return "ordered";
  return false;
};

const stripListItemMarker = (line: string): string => {
  return line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
};

const isBlockquoteLine = (line: string): boolean => /^\s*>\s?/.test(line);

const stripBlockquoteMarker = (line: string): string => line.replace(/^\s*>\s?/, "");

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

    // Blockquote: collect consecutive > lines
    if (isBlockquoteLine(lines[index])) {
      const quoteLines: string[] = [];
      while (index < lines.length && isBlockquoteLine(lines[index])) {
        quoteLines.push(stripBlockquoteMarker(lines[index]));
        index += 1;
      }
      const quoteText = quoteLines.join("\n").trim();
      content.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: parseInlineMarkdown(quoteText) }],
      });
      continue;
    }

    // Unordered list: collect consecutive bullet items
    if (isListItem(lines[index]) === "bullet") {
      const listItems: TiptapNode[] = [];
      while (index < lines.length && isListItem(lines[index]) === "bullet") {
        const itemText = stripListItemMarker(lines[index]);
        listItems.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }],
        });
        index += 1;
      }
      content.push({ type: "bulletList", content: listItems });
      continue;
    }

    // Ordered list: collect consecutive ordered items
    if (isListItem(lines[index]) === "ordered") {
      const listItems: TiptapNode[] = [];
      while (index < lines.length && isListItem(lines[index]) === "ordered") {
        const itemText = stripListItemMarker(lines[index]);
        listItems.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }],
        });
        index += 1;
      }
      content.push({ type: "orderedList", content: listItems });
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
        content: parseInlineMarkdown(heading[2]!),
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
      content: parseInlineMarkdown(block),
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
        marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
        attrs?: Record<string, unknown>;
        content?: unknown;
      };

      if (typeof current.text === "string") {
        const marks = current.marks;
        let text = current.text;

        if (marks && marks.length > 0) {
          // Apply marks in reverse order (outermost first)
          for (let i = marks.length - 1; i >= 0; i--) {
            const mark = marks[i];
            if (mark.type === "bold") {
              text = `**${text}**`;
            } else if (mark.type === "italic") {
              text = `*${text}*`;
            } else if (mark.type === "code") {
              text = `\`${text}\``;
            } else if (mark.type === "strike") {
              text = `~~${text}~~`;
            } else if (mark.type === "link") {
              const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
              text = `[${text}](${href})`;
            }
          }
        }

        return text;
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
