import notionLogo from "@/assets/import-logos/notion.png?url";
import siyuanLogo from "@/assets/import-logos/siyuan.png?url";
import flomoLogo from "@/assets/import-logos/flomo.png?url";
import evernoteLogo from "@/assets/import-logos/evernote.svg?url";
import joplinLogo from "@/assets/import-logos/joplin.svg?url";
import obsidianLogo from "@/assets/import-logos/obsidian.svg?url";
import type { ImportFormat } from "@edgeever/shared/note-import/types";
import { prefersChineseContent } from "@/lib/bilingual-content-locale";

export interface ImportSourceMeta {
  format: ImportFormat;
  label: string;
  logo: string;
  formatHint: string;
}

/**
 * Shared metadata for supported third-party note import sources across settings cards and dialogs.
 */
export function getImportSources(language?: string | null): Record<ImportFormat, ImportSourceMeta> {
  const zh = prefersChineseContent(language);
  return {
    notion: { format: "notion", label: "Notion", logo: notionLogo, formatHint: "Markdown & CSV · .zip" },
    siyuan: { format: "siyuan", label: zh ? "SiYuan / 思源" : "SiYuan", logo: siyuanLogo, formatHint: "Markdown · .zip" },
    flomo: { format: "flomo", label: "flomo", logo: flomoLogo, formatHint: "HTML · .zip" },
    evernote: { format: "evernote", label: zh ? "Evernote / 印象笔记" : "Evernote", logo: evernoteLogo, formatHint: ".enex · .zip" },
    obsidian: { format: "obsidian", label: "Obsidian", logo: obsidianLogo, formatHint: zh ? "Vault 目录 · .zip" : "Vault folder · .zip" },
    joplin: { format: "joplin", label: "Joplin", logo: joplinLogo, formatHint: ".jex · RAW · .zip" },
  };
}
