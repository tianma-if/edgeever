import { isMap, parseDocument } from "yaml";
import type { TiptapDoc, TiptapNode } from "./content";

// An existing schema node keeps properties readable in older clients.
export const FRONT_MATTER_LANGUAGE = "edgeever-frontmatter";
const MAX_PROPERTY_SOURCE_LENGTH = 64 * 1024;

export const parseNoteProperties = (source: string) => {
  try {
    if (source.length > MAX_PROPERTY_SOURCE_LENGTH) throw new Error("Properties exceed 64 KiB.");
    const document = parseDocument(source, { stringKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) {
      throw new Error([...document.errors, ...document.warnings].map((error) => error.message).join("\n"));
    }
    if (document.contents !== null && !isMap(document.contents)) throw new Error("Properties must be a YAML mapping.");
    const values = document.toJS({ maxAliasCount: 50 }) as Record<string, unknown> | null;
    // Recursive YAML aliases cannot be displayed or persisted as JSON values.
    JSON.stringify(values);
    return { document, values: values ?? {}, error: null };
  } catch (error) {
    return { document: null, values: null, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Only a leading, closed property header is special; ordinary rules stay Markdown. */
export const splitMarkdownFrontMatter = (markdown: string) => {
  const legacy = /^(`{3,}|~{3,})edgeever-frontmatter[ \t]*\r?\n([\s\S]*?)^\1[ \t]*(?:\r?\n|$)/m.exec(markdown);
  if (legacy?.index === 0) {
    const source = legacy[2]!.replace(/\r?\n$/, "").replace(/\r\n?/g, "\n");
    return { source, body: markdown.slice(legacy[0].length), ...parseNoteProperties(source) };
  }
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(markdown);
  if (!match || match.index !== 0) return null;
  const source = match[1]!.replace(/\r?\n$/, "").replace(/\r\n?/g, "\n");
  const parsed = parseNoteProperties(source);
  // Don't turn `---\nA paragraph\n---` into a properties panel.
  if (parsed.error && !source.includes(":")) return null;
  return { source, body: markdown.slice(match[0].length), ...parsed };
};

export const isFrontMatterNode = (node: TiptapNode | undefined) =>
  node?.type === "codeBlock" && node.attrs?.language === FRONT_MATTER_LANGUAGE;

export const getFrontMatterSource = (doc: TiptapDoc) => isFrontMatterNode(doc.content[0])
  ? doc.content[0]!.content?.map((node) => "text" in node && typeof node.text === "string" ? node.text : "").join("") ?? ""
  : null;

export const createFrontMatterNode = (source: string): TiptapNode => ({
  type: "codeBlock", attrs: { language: FRONT_MATTER_LANGUAGE },
  ...(source ? { content: [{ type: "text", text: source }] } : {}),
});

/** Modify the YAML AST so untouched comments, unknown keys and nested values survive. */
export const updateNoteProperty = (source: string, name: string, value: unknown, remove = false) => {
  const { document, error } = parseNoteProperties(source);
  if (!document) throw new Error(error ?? "Invalid properties.");
  if (remove) document.delete(name);
  else document.set(name, value);
  return document.toString({ lineWidth: 0 }).trimEnd();
};

export const getMappedNoteProperties = (values: Record<string, unknown>) => {
  const title = typeof values.title === "string" && values.title.trim().length <= 160 ? values.title.trim() : undefined;
  const rawTags = typeof values.tags === "string" ? values.tags.split(/[\s,]+/) : values.tags;
  const tags = Array.isArray(rawTags) && rawTags.every((tag) => typeof tag === "string")
    ? [...new Set(rawTags.map((tag: string) => tag.trim().replace(/^#/, "")).filter(Boolean))]
    : undefined;
  return { ...(title !== undefined ? { title } : {}), ...(tags !== undefined ? { tags } : {}) };
};

/** Export one header, with live application metadata taking precedence over imported copies. */
export const mergeMarkdownFrontMatter = (markdown: string, metadata: Record<string, unknown>) => {
  const split = splitMarkdownFrontMatter(markdown);
  // An invalid header must remain recoverable verbatim.
  if (split?.error) return markdown;
  let source = split?.source ?? "";
  for (const [key, value] of Object.entries(metadata)) source = updateNoteProperty(source, key, value);
  return `---\n${source}\n---\n\n${(split?.body ?? markdown).replace(/^\r?\n/, "")}`;
};
