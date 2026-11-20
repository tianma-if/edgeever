import type { ImportFormat } from "@edgeever/shared/note-import/types";

export interface ImportPickerEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

const IMPORT_FILE_ACCEPT: Record<ImportFormat, string> = {
  notion: ".md,.markdown,.csv,.zip",
  siyuan: ".md,.markdown,.zip",
  flomo: ".html,.htm,.zip",
  evernote: ".enex,.zip,.notes",
  joplin: ".zip,.jex",
  obsidian: ".zip",
  markdown: ".md,.markdown",
};

const CUSTOM_EXTENSION_FORMATS = new Set<ImportFormat>(["evernote", "joplin"]);

function hasOmittedCustomExtensionAccept(env?: ImportPickerEnvironment): boolean {
  const target = env ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!target) return false;
  const userAgent = target.userAgent ?? "";
  const platform = target.platform ?? "";
  const maxTouchPoints = target.maxTouchPoints ?? 0;
  // iOS/iPadOS UIDocumentPickerViewController and Android file pickers drop unknown
  // extensions (like .jex/.enex/.notes) when resolving `accept` to UTIs/MIME types,
  // which greys out valid exports alongside .zip.
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (/MacIntel/i.test(platform) && maxTouchPoints > 1);
  const isAndroid = /Android/i.test(userAgent);
  return isIOS || isAndroid;
}

/**
 * Returns the `<input type="file" accept>` value for a third-party import source,
 * omitting `accept` on mobile platforms where custom extensions cannot be mapped to UTIs/MIME types.
 */
export function getImportFileAccept(format: ImportFormat, env?: ImportPickerEnvironment): string | undefined {
  if (CUSTOM_EXTENSION_FORMATS.has(format) && hasOmittedCustomExtensionAccept(env)) {
    return undefined;
  }
  return IMPORT_FILE_ACCEPT[format];
}
