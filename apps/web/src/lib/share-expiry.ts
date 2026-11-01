export const SHARE_EXPIRY_PRESET_DAYS = [1, 7, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Expiry instant for a preset, counted from now. */
export const shareExpiryFromPreset = (days: number, now = new Date()) =>
  new Date(now.getTime() + days * DAY_MS).toISOString();

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` in local time, the format of a date input. */
export const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A custom date keeps the link working until the end of that day in the owner's time zone. */
export const shareExpiryFromDateInput = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
};
