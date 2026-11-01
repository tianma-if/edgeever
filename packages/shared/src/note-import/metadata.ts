import { getMappedNoteProperties, splitMarkdownFrontMatter } from "../front-matter";
import type { ImportIndex, ImportNote } from "./types";
import { addIssue } from "./sources";

export const importTime = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim()) return;
  let text = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:)/, "$1T");
  const compact = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(text);
  if (compact) text = `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return;
  const day = text.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return;
  return date.toISOString();
};
export const readMarkdownMetadata = async (markdown: string, title: string, index: ImportIndex, path: string) => {
  // The editor's interactive parsing budget is not an import/storage limit.
  const header = splitMarkdownFrontMatter(markdown, { maxSourceLength: Infinity });
  if (header?.error) await addIssue(index, "invalidProperties", path, "error", header.error);
  const values = header?.values ?? {};
  const mapped = getMappedNoteProperties(values);
  // Do not let the ordinary single-file import's title fallback hide a limit violation.
  const rawTitle = typeof values.title === "string" ? values.title.trim() : mapped.title ?? title;
  const times: { createdAt?: string; updatedAt?: string } = {};
  for (const [a, b] of [["created", "createdAt"], ["updated", "updatedAt"]] as const) {
    const first = importTime(values[a]);
    const second = importTime(values[b]);
    if (values[a] !== undefined && values[b] !== undefined && (first !== second || !first)) await addIssue(index, "conflictingTimes", path);
    const raw = values[b] ?? values[a];
    times[b] = importTime(raw);
    if (raw !== undefined && !times[b]) await addIssue(index, "invalidTime", path, "warning", String(raw));
  }
  return { title: rawTitle, tags: mapped.tags ?? [], ...times };
};
export const prepareImportNote = async (index: ImportIndex, note: ImportNote) => {
  const tags = [...new Set(note.tags.map(tag => tag.trim().replace(/^#+/, "")).filter(Boolean))];
  note.tags = tags.slice(0, 24);
  if (tags.length > 24) await addIssue(index, "ignoredTags", note.path, "warning", String(tags.length - 24));
  if (note.title.length > 160) await addIssue(index, "titleTooLong", note.path);
  if (!note.createdAt || !note.updatedAt) await addIssue(index, "missingTimes", note.path, "warning");
  for (const resource of note.resources) {
    const maximum = resource.mimeType.startsWith("image/") ? 100 * 1024 * 1024 : 1024 * 1024 * 1024;
    if (resource.byteSize <= 0 || resource.byteSize > maximum) await addIssue(index, "resourceSize", note.path, "error", resource.filename);
  }
};
export const mimeFromName = (name: string) => {
  const extension = name.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", mp3: "audio/mpeg", mp4: "video/mp4", json: "application/json", zip: "application/zip" };
  return extension && Object.hasOwn(types, extension) ? types[extension]! : "application/octet-stream";
};
