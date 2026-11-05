import { companionTurnLocale } from "@edgeever/shared";

// Servers before expanded companion support reject newer locale codes, so non-supported
// interface locales map to zh-CN (for Chinese) or en-US (for other languages).
export function companionLocale(language?: string): "zh-CN" | "en-US" | "ja" | "pl" {
  const code = companionTurnLocale(language);
  if (code === "zh-CN" || code === "zh-TW") return "zh-CN";
  if (code === "ja") return "ja";
  if (code === "pl") return "pl";
  const locale = code;
  return locale === "ru" ? "en-US" : "en-US";
}
