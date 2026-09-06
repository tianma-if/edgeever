export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export const isoNow = () => new Date().toISOString();

export const clampNumber = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);

export const parseJsonArray = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
