/** Use only the note's own tags, in their existing order. */
export const formatNoteCoverTags = (tags: readonly string[] = []) => tags
  .map((tag) => tag.trim().replace(/^#/, "").trim())
  .filter(Boolean)
  .slice(0, 3)
  .join(" · ");

export const noteCoverTagCssVariables = (tags: readonly string[] = []) => {
  const label = formatNoteCoverTags(tags);
  // CSS strings need CSS escapes, rather than JSON/JavaScript escapes.
  const escaped = `● ${label}`.replace(/["\\\x00-\x1f\x7f]/g, (char) =>
    `\\${char.codePointAt(0)!.toString(16)} `);
  return { "--note-cover-tags": label ? `"${escaped}"` : "none" };
};

export const readNoteCoverTags = (serialized?: string): string => {
  try {
    const tags: unknown = JSON.parse(serialized || "[]");
    return Array.isArray(tags) ? formatNoteCoverTags(tags.filter((tag): tag is string => typeof tag === "string")) : "";
  } catch {
    return "";
  }
};
