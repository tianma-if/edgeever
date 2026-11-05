export const supportedLocales = ["zh-CN", "zh-TW", "en-US", "ja", "pl", "ru", "es", "de", "fr"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

/** English names for instructions to AI models, such as "Reply in Polish". */
export const localeEnglishNames: Record<SupportedLocale, string> = {
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  "en-US": "English",
  ja: "Japanese",
  pl: "Polish",
  ru: "Russian",
  es: "Spanish",
  de: "German",
  fr: "French",
};

/** Used when there is no locale evidence (legacy callers, missing headers). */
export const defaultLocale: SupportedLocale = "zh-CN";

/** Used when locale evidence exists but is not a shipped UI language. */
export const unmatchedLocale: SupportedLocale = "en-US";

export const matchSupportedLocale = (locale: string | null | undefined): SupportedLocale | null => {
  if (!locale) {
    return null;
  }

  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();

  if (
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo" ||
    normalized === "zh-hant" ||
    normalized.startsWith("zh-tw-") ||
    normalized.startsWith("zh-hk-") ||
    normalized.startsWith("zh-mo-") ||
    normalized.startsWith("zh-hant-")
  ) {
    return "zh-TW";
  }

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en-US";
  }

  if (normalized === "ja" || normalized.startsWith("ja-")) {
    return "ja";
  }

  if (normalized === "pl" || normalized.startsWith("pl-")) {
    return "pl";
  }

  if (normalized === "ru" || normalized.startsWith("ru-")) {
    return "ru";
  }

  if (normalized === "es" || normalized.startsWith("es-")) {
    return "es";
  }

  if (normalized === "de" || normalized.startsWith("de-")) {
    return "de";
  }

  if (normalized === "fr" || normalized.startsWith("fr-")) {
    return "fr";
  }

  return null;
};

export const parseAcceptLanguage = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter(Boolean);

export const resolveSupportedLocaleFromCandidates = (
  candidates: readonly (string | null | undefined)[],
): SupportedLocale => {
  let sawCandidate = false;

  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) {
      continue;
    }

    sawCandidate = true;

    for (const tag of parseAcceptLanguage(candidate)) {
      const matched = matchSupportedLocale(tag);

      if (matched) {
        return matched;
      }
    }
  }

  return sawCandidate ? unmatchedLocale : defaultLocale;
};

export const resolveSupportedLocale = (locale?: string | null): SupportedLocale =>
  resolveSupportedLocaleFromCandidates(locale ? [locale] : []);
