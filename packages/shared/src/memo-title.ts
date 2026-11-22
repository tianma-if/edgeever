/** Kept free of imports so server entry points loaded by Node can use it. */

export const DEFAULT_MEMO_TITLE = "无标题笔记";

/**
 * Title to show for a note. Untitled notes are stored with the zh-CN default
 * title, so it is replaced by the reader's localized label like an empty one.
 */
export const getMemoDisplayTitle = (title: string | null | undefined, untitledLabel: string) => {
  const trimmed = title?.trim() ?? "";
  return trimmed && trimmed !== DEFAULT_MEMO_TITLE ? trimmed : untitledLabel;
};

/**
 * Creation date-and-time label for an untitled note, formatted with the
 * viewer's locale and time zone. Seconds are included so notes created
 * within the same minute still read differently. Returns null when the
 * timestamp is missing or invalid.
 */
export const formatMemoCreatedAtLabel = (
  createdAt: string | null | undefined,
  locale: string,
): string | null => {
  if (!createdAt) {
    return null;
  }

  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
};

/**
 * Title to show for a note in the private workspace lists and pickers.
 * Untitled notes fall back to their creation date and time, then to the
 * localized untitled label when no valid creation time is available.
 * Display only; the stored title is never changed.
 */
export const getMemoDisplayTitleWithCreatedAt = (
  title: string | null | undefined,
  createdAt: string | null | undefined,
  untitledLabel: string,
  locale: string,
) => {
  const trimmed = title?.trim() ?? "";

  if (trimmed && trimmed !== DEFAULT_MEMO_TITLE) {
    return trimmed;
  }

  return formatMemoCreatedAtLabel(createdAt, locale) ?? untitledLabel;
};
