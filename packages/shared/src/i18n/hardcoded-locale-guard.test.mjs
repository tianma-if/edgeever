import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// UI text comes from the catalogs and code passes locale codes through. A new
// comparison against a specific language usually means a screen that some
// languages will not get, so it has to be justified here first.
const root = join(import.meta.dir, "../../../..");
const scanned = ["apps/web/src", "apps/desktop/src", "apps/api/src", "apps/extension/src", "packages/shared/src"];
// `i18n` directories hold the locale resolvers and catalogs themselves.
const skippedDirectories = new Set(["node_modules", "dist", "i18n"]);

const languagePatterns = [
  /(?:locale|language|lang|lng|resolvedLanguage)\b[\w?.()"']*\s*[!=]==\s*["'](?:zh|en|ja|pl|ru)\b/i,
  /["'](?:zh|en|ja|pl|ru)(?:-[A-Za-z]+)?["']\s*[!=]==\s*[\w?.]*(?:locale|language)\b/i,
  /\.startsWith\(\s*["'](?:zh|en|ja|pl|ru)\b/,
  /\b(?:english|chinese|isEnglish|isChinese|isZh|isEn)\s*\?/,
  /\bcase\s+["'](?:zh|en|ja|pl|ru)(?:-[A-Za-z]+)?["']\s*:/,
  /\[\s*["'](?:zh|en|ja|pl|ru)(?:-[A-Za-z]+)?["'][^\]]*\]\.includes\(/,
];

// Justified exceptions: `file`, a fragment of each matching line, and why.
const allowed = [
  { file: "apps/desktop/src/main/desktop-copy.mjs", line: "if (language === ", reason: "locale resolver of the desktop main process, which cannot import the shared one" },
  { file: "apps/web/src/lib/bilingual-content-locale.ts", line: 'matchSupportedLocale(locale) === "zh-CN"', reason: "single helper for bundled content that exists only in Chinese and English" },
  { file: "apps/web/src/lib/bilingual-content-locale.ts", line: 'bilingualContentLocale(locale) === "zh-CN";', reason: "same helper" },
  { file: "apps/web/src/lib/companion-locale.ts", line: 'locale === "ru" ? "en-US"', reason: "servers before Russian companion support reject \"ru\"" },
  { file: "apps/web/src/components/settings/ai-provider-options.ts", line: 'startsWith("zh") || position', reason: "Chinese ordinal numerals have no Intl equivalent; other locales use digits" },
  { file: "apps/web/src/lib/infographic-samples.ts", line: "if (lang && lang.toLowerCase().startsWith(", reason: "sample titles and descriptions are authored only in Chinese, English and Japanese" },
  { file: "apps/extension/src/video/transcript.ts", line: "if (normalized.startsWith(", reason: "groups subtitle tracks by content language" },
  { file: "apps/extension/src/video/read-youtube-in-page.ts", line: "if (normalized.startsWith(", reason: "groups subtitle tracks by content language" },
  { file: "apps/extension/src/video/read-bilibili-in-page.ts", line: "if (normalized.startsWith(", reason: "groups subtitle tracks by content language" },
  { file: "packages/shared/src/ai-tag-suggestions.ts", line: 'locale?.toLocaleLowerCase().startsWith("zh")', reason: "the default prompt exists only in Chinese and English; output follows the note's language" },
  { file: "packages/shared/src/companion.ts", line: 'fallbackLocale !== "pl"', reason: "tells English from Polish typed without diacritics" },
];

const sourceFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : sourceFiles(path);
  return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name) ? [path] : [];
});

const findings = () => scanned.flatMap((directory) => sourceFiles(join(root, directory)).flatMap((path) => {
  const file = relative(root, path);
  return readFileSync(path, "utf8").split("\n").flatMap((line, index) => (
    languagePatterns.some((pattern) => pattern.test(line))
    && !allowed.some((entry) => entry.file === file && line.includes(entry.line))
      ? [`${file}:${index + 1}: ${line.trim()}`]
      : []
  ));
}));

describe("hard-coded UI language checks", () => {
  test("code outside i18n resolves locale codes instead of comparing languages", () => {
    expect(findings()).toEqual([]);
  });

  test("every allowed exception still exists", () => {
    const stale = allowed.filter((entry) => !readFileSync(join(root, entry.file), "utf8").includes(entry.line));
    expect(stale).toEqual([]);
  });
});
