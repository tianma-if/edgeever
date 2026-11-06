import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getMemoDisplayTitle } from "@edgeever/shared";

export const UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY = "edgeever.untitledMemoDateFormat";

export const UNTITLED_MEMO_DATE_FORMAT_CHANGED_EVENT = "edgeever:untitled-memo-date-format-changed";

export const UNTITLED_MEMO_DATE_FORMATS = ["medium", "short", "long", "iso", "date", "off"] as const;

export type UntitledMemoDateFormat = (typeof UNTITLED_MEMO_DATE_FORMATS)[number];

export const DEFAULT_UNTITLED_MEMO_DATE_FORMAT: UntitledMemoDateFormat = "medium";

const INTL_OPTIONS: Record<Exclude<UntitledMemoDateFormat, "iso" | "off">, Intl.DateTimeFormatOptions> = {
  medium: { dateStyle: "medium", timeStyle: "short" },
  short: { dateStyle: "short", timeStyle: "short" },
  long: { dateStyle: "long", timeStyle: "short" },
  date: { dateStyle: "medium" },
};

// Note lists render many rows, so formatters are reused per locale and format.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (locale: string, format: keyof typeof INTL_OPTIONS, timeZone?: string) => {
  const key = `${locale}|${format}|${timeZone ?? ""}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...INTL_OPTIONS[format], timeZone });
    formatterCache.set(key, formatter);
  }
  return formatter;
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Creation time shown next to the untitled label, in the viewer's time zone.
 * Returns null when the format is off or the timestamp cannot be parsed.
 */
export const formatUntitledMemoDate = (
  createdAt: string | null | undefined,
  locale: string,
  format: UntitledMemoDateFormat,
  timeZone?: string,
): string | null => {
  if (format === "off" || !createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  if (format === "iso") {
    if (timeZone) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(date).map((part) => [part.type, part.value]),
      );
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  try {
    return getFormatter(locale, format, timeZone).format(date);
  } catch {
    return null;
  }
};

export const resolveStoredUntitledMemoDateFormat = (stored: string | null): UntitledMemoDateFormat =>
  UNTITLED_MEMO_DATE_FORMATS.find((format) => format === stored) ?? DEFAULT_UNTITLED_MEMO_DATE_FORMAT;

// Holds the choice while localStorage rejects writes, so the setting still
// applies for the rest of this page session.
let unsavedPreference: UntitledMemoDateFormat | null = null;

export const readUntitledMemoDateFormatPreference = (): UntitledMemoDateFormat => {
  if (typeof window === "undefined") return DEFAULT_UNTITLED_MEMO_DATE_FORMAT;
  if (unsavedPreference !== null) return unsavedPreference;
  try {
    return resolveStoredUntitledMemoDateFormat(
      window.localStorage?.getItem(UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY) ?? null,
    );
  } catch {
    return DEFAULT_UNTITLED_MEMO_DATE_FORMAT;
  }
};

export const writeUntitledMemoDateFormatPreference = (format: UntitledMemoDateFormat) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY, format);
    unsavedPreference = null;
  } catch {
    // Private mode / blocked storage — keep the choice in memory for this session.
    unsavedPreference = format;
  }
  window.dispatchEvent(new CustomEvent(UNTITLED_MEMO_DATE_FORMAT_CHANGED_EVENT, { detail: format }));
};

const subscribe = (onChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY) onChange();
  };
  window.addEventListener(UNTITLED_MEMO_DATE_FORMAT_CHANGED_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(UNTITLED_MEMO_DATE_FORMAT_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
};

export const useUntitledMemoDateFormatPreference = () =>
  useSyncExternalStore(subscribe, readUntitledMemoDateFormatPreference, () => DEFAULT_UNTITLED_MEMO_DATE_FORMAT);

type MemoTitleSource = { title?: string | null; createdAt?: string | null };

/**
 * Display label for a note in the private workspace. Untitled notes get their
 * creation time so they can be told apart; the stored title is never changed,
 * so links and exports keep using the plain title.
 */
export const resolveMemoDisplayLabel = (
  memo: MemoTitleSource,
  locale: string,
  format: UntitledMemoDateFormat,
  labels: { untitled: string; withDate: (date: string) => string },
  timeZone?: string,
) => {
  const title = getMemoDisplayTitle(memo.title, "");
  if (title) return title;
  const date = formatUntitledMemoDate(memo.createdAt, locale, format, timeZone);
  return date ? labels.withDate(date) : labels.untitled;
};

export const useMemoDisplayLabel = () => {
  const { t, i18n } = useTranslation();
  const format = useUntitledMemoDateFormatPreference();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return useCallback((memo: MemoTitleSource) => resolveMemoDisplayLabel(memo, locale, format, {
    untitled: t("common.untitledMemo"),
    withDate: (date) => t("common.untitledMemoWithDate", { date }),
  }), [format, locale, t]);
};
