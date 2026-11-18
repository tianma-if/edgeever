const MAX_RICH_TEXT_CHARS = 1900;
const MAX_RICH_TEXT_ITEMS = 95;

const STRUCTURED_EDGEEVER_MARKER_REGEX =
  /<!--\s*edgeever-(?:poster|table|diagram|infographic)-v1:[\s\S]*?-->/g;

export const hasStructuredNoteMarker = (markdown: string): boolean =>
  /<!--\s*edgeever-(?:poster|table|diagram|infographic)-v1:/.test(markdown);

export const stripStructuredNoteMarker = (markdown: string): string =>
  markdown.replace(STRUCTURED_EDGEEVER_MARKER_REGEX, "").trim();

const NOTION_CODE_LANGUAGES = new Set([
  "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#",
  "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran",
  "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java",
  "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript",
  "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
  "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf",
  "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss",
  "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic",
  "webassembly", "xml", "yaml", "java/c/c++/c#",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shell",
  zsh: "shell",
  ps1: "powershell",
  yml: "yaml",
  md: "markdown",
  cpp: "c++",
  cs: "c#",
  csharp: "c#",
  dockerfile: "docker",
  txt: "plain text",
  text: "plain text",
};

export type NotionRichTextItem = {
  type: "text";
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
  };
  plain_text?: string;
  href?: string | null;
};

export type NotionBlockPayload = Record<string, any>;

const normalizeCodeLanguage = (raw: string): string => {
  const lower = raw.trim().toLowerCase();
  if (!lower) return "plain text";
  const mapped = LANGUAGE_ALIASES[lower] ?? lower;
  return NOTION_CODE_LANGUAGES.has(mapped) ? mapped : "plain text";
};

const splitSafeChunks = (text: string, maxLen = MAX_RICH_TEXT_CHARS): string[] => {
  if (!text) return [""];
  const chars = Array.from(text);
  const chunks: string[] = [];
  let current = "";
  for (const ch of chars) {
    if (current.length + ch.length > maxLen) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const chunkRichTextItems = (items: NotionRichTextItem[]): NotionRichTextItem[][] => {
  if (items.length <= MAX_RICH_TEXT_ITEMS) return [items];
  const groups: NotionRichTextItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_RICH_TEXT_ITEMS) {
    groups.push(items.slice(i, i + MAX_RICH_TEXT_ITEMS));
  }
  return groups;
};

const isPublicHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const inlineMarkdownToNotionRichText = (text: string): NotionRichTextItem[] => {
  if (!text) return [];

  const tokenRegex =
    /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*)/g;

  const segments: NotionRichTextItem[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushText = (
    content: string,
    annotations?: NotionRichTextItem["annotations"],
    linkUrl?: string,
  ) => {
    if (!content) return;
    for (const chunk of splitSafeChunks(content)) {
      segments.push({
        type: "text",
        text: {
          content: chunk,
          ...(linkUrl && isPublicHttpUrl(linkUrl) ? { link: { url: linkUrl } } : {}),
        },
        ...(annotations ? { annotations } : {}),
      });
    }
  };

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      pushText(match[1].slice(1, -1), { code: true });
    } else if (match[2]) {
      pushText(match[3]!, undefined, match[4]!);
    } else if (match[5]) {
      pushText(match[6]!, { bold: true });
    } else if (match[7]) {
      pushText(match[8]!, { strikethrough: true });
    } else if (match[9]) {
      pushText(match[10]!, { italic: true });
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex));
  }

  return segments;
};

export const markdownToNotionBlocks = (markdown: string): NotionBlockPayload[] => {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: NotionBlockPayload[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fenceMatch = line.match(/^```([^\s`]*)\s*$/);
    if (fenceMatch) {
      const language = normalizeCodeLanguage(fenceMatch[1] ?? "");
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const codeRichText = splitSafeChunks(codeLines.join("\n")).map((chunk) => ({
        type: "text" as const,
        text: { content: chunk },
      }));
      for (const group of chunkRichTextItems(codeRichText)) {
        blocks.push({
          object: "block",
          type: "code",
          code: { language, rich_text: group },
        });
      }
      continue;
    }

    if (/^(?:---|\*\*\*|___)\s*$/.test(line.trim())) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i += 1;
      continue;
    }

    const imageMatch = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
    if (imageMatch && isPublicHttpUrl(imageMatch[2]!)) {
      blocks.push({
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: imageMatch[2]! },
          ...(imageMatch[1]
            ? { caption: inlineMarkdownToNotionRichText(imageMatch[1]).slice(0, MAX_RICH_TEXT_ITEMS) }
            : {}),
        },
      });
      i += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1]!.length, 3) as 1 | 2 | 3;
      const key = `heading_${level}`;
      for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(headingMatch[2]!.trim()))) {
        blocks.push({ object: "block", type: key, [key]: { rich_text: group } });
      }
      i += 1;
      continue;
    }

    const todoMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (todoMatch) {
      for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(todoMatch[2]!))) {
        blocks.push({
          object: "block",
          type: "to_do",
          to_do: {
            checked: todoMatch[1]!.toLowerCase() === "x",
            rich_text: group,
          },
        });
      }
      i += 1;
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(bulletMatch[1]!))) {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: group },
        });
      }
      i += 1;
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numberedMatch) {
      for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(numberedMatch[1]!))) {
        blocks.push({
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: { rich_text: group },
        });
      }
      i += 1;
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines = [quoteMatch[1]!];
      i += 1;
      while (i < lines.length && /^>\s?(.*)$/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(quoteLines.join("\n")))) {
        blocks.push({
          object: "block",
          type: "quote",
          quote: { rich_text: group },
        });
      }
      continue;
    }

    const paraLines = [line];
    i += 1;
    while (
      i < lines.length
      && lines[i]!.trim() !== ""
      && !lines[i]!.startsWith("```")
      && !/^(?:#{1,6}\s|---|\*\*\*|___|>\s?|\s*[-*+]\s|\s*\d+\.\s|!\[[^\]]*\]\(https?:\/\/)/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i += 1;
    }

    for (const group of chunkRichTextItems(inlineMarkdownToNotionRichText(paraLines.join("\n")))) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: group },
      });
    }
  }

  return blocks;
};

export const notionRichTextToInlineMarkdown = (items: NotionRichTextItem[] | undefined): string => {
  if (!Array.isArray(items) || items.length === 0) return "";

  return items
    .map((item) => {
      const raw = item.plain_text ?? item.text?.content ?? "";
      if (!raw) return "";
      const link = item.href ?? item.text?.link?.url ?? null;
      const ann = item.annotations ?? {};

      let formatted = raw;
      if (ann.code) {
        formatted = `\`${formatted}\``;
      } else {
        if (ann.bold) formatted = `**${formatted}**`;
        if (ann.italic) formatted = `*${formatted}*`;
        if (ann.strikethrough) formatted = `~~${formatted}~~`;
      }
      if (link) {
        formatted = `[${formatted}](${link})`;
      }
      return formatted;
    })
    .join("");
};

export const notionBlocksToMarkdown = (blocks: NotionBlockPayload[]): string => {
  const out: string[] = [];
  const isList = (type: string | null) =>
    type === "bulleted_list_item" || type === "numbered_list_item" || type === "to_do";

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const type = block.type as string;
    const prevType = i > 0 ? (blocks[i - 1]!.type as string) : null;

    if (out.length > 0 && !(isList(type) && prevType === type)) {
      out.push("");
    }

    switch (type) {
      case "heading_1":
        out.push(`# ${notionRichTextToInlineMarkdown(block.heading_1?.rich_text)}`);
        break;
      case "heading_2":
        out.push(`## ${notionRichTextToInlineMarkdown(block.heading_2?.rich_text)}`);
        break;
      case "heading_3":
        out.push(`### ${notionRichTextToInlineMarkdown(block.heading_3?.rich_text)}`);
        break;
      case "paragraph":
        out.push(notionRichTextToInlineMarkdown(block.paragraph?.rich_text));
        break;
      case "bulleted_list_item":
        out.push(`- ${notionRichTextToInlineMarkdown(block.bulleted_list_item?.rich_text)}`);
        break;
      case "numbered_list_item":
        out.push(`1. ${notionRichTextToInlineMarkdown(block.numbered_list_item?.rich_text)}`);
        break;
      case "to_do":
        out.push(
          `- [${block.to_do?.checked ? "x" : " "}] ${notionRichTextToInlineMarkdown(block.to_do?.rich_text)}`,
        );
        break;
      case "quote":
        out.push(
          notionRichTextToInlineMarkdown(block.quote?.rich_text)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        );
        break;
      case "callout": {
        const icon = block.callout?.icon?.emoji ? `${block.callout.icon.emoji} ` : "";
        out.push(`> ${icon}${notionRichTextToInlineMarkdown(block.callout?.rich_text)}`);
        break;
      }
      case "code": {
        const lang = block.code?.language === "plain text" ? "" : (block.code?.language ?? "");
        const code = (block.code?.rich_text ?? [])
          .map((item: NotionRichTextItem) => item.plain_text ?? item.text?.content ?? "")
          .join("");
        out.push(`\`\`\`${lang}\n${code}\n\`\`\``);
        break;
      }
      case "divider":
        out.push("---");
        break;
      case "image": {
        const url = block.image?.external?.url ?? block.image?.file?.url ?? "";
        const caption = notionRichTextToInlineMarkdown(block.image?.caption);
        if (url) out.push(`![${caption}](${url})`);
        break;
      }
      case "bookmark": {
        const url = block.bookmark?.url ?? "";
        if (url) out.push(`[${url}](${url})`);
        break;
      }
      default: {
        const data = block[type];
        if (data?.rich_text) {
          out.push(notionRichTextToInlineMarkdown(data.rich_text));
        }
        break;
      }
    }
  }

  return out.join("\n").trim();
};
