// Upload folder templates use PicList's rename placeholders, expanded in the
// uploader's local time zone, plus EdgeEver's {memoId}. File-specific tokens
// ({filename}, {md5}, ...) are not supported because ImgBed names the file itself.
export const IMGBED_NAME_TYPES = ["default", "index", "origin", "short"] as const;
export type ImgBedNameType = typeof IMGBED_NAME_TYPES[number];
// Defaults follow the ImgBed upload API: telegram channel with server compression on.
export const IMGBED_UPLOAD_CHANNELS = ["telegram", "cfr2", "s3", "discord", "huggingface", "webdav"] as const;
export type ImgBedUploadChannel = typeof IMGBED_UPLOAD_CHANNELS[number];
// `key` names the description in settings.picgo.imgbed.placeholders.
export const IMGBED_FOLDER_PLACEHOLDERS = [
  { token: "{Y}", key: "Y" }, { token: "{y}", key: "y" }, { token: "{m}", key: "m" }, { token: "{d}", key: "d" },
  { token: "{h}", key: "h" }, { token: "{i}", key: "i" }, { token: "{s}", key: "s" }, { token: "{ms}", key: "ms" },
  { token: "{timestamp}", key: "timestamp" }, { token: "{timestampS}", key: "timestampS" }, { token: "{uuid}", key: "uuid" },
  { token: "{str-N}", key: "strN" }, { token: "{memoId}", key: "memoId" },
] as const;
export const IMGBED_SAMPLE_MEMO_ID = "memo_example";

// Matches the main process limit on the expanded folder.
export const IMGBED_MAX_FOLDER_LENGTH = 200;
// Server ids are memo_ + 32 hex characters; restored ids are capped so the worst case stays bounded.
export const IMGBED_MAX_MEMO_ID_LENGTH = 64;
const STRING_PATTERN = /^str-(\d{1,2})$/;
// oxlint-disable-next-line no-control-regex -- rejects control characters in the upload folder
const INVALID_FOLDER_CHARACTERS = /[\u0000-\u001f\u007f\\?#%<>:*|"]/;
const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export type ImgBedFolderError = "placeholder" | "characters" | "length";
// Without a note (connection test), {memoId} expands to nothing and its folder level is dropped.
export type ImgBedFolderContext = { memoId?: string };

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const randomString = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length]).join("");
};

const placeholderValue = (name: string, now: Date, context: ImgBedFolderContext = {}): string | null => {
  switch (name) {
    case "memoId": return (context.memoId ?? "").replace(/[^\w-]/g, "").slice(0, IMGBED_MAX_MEMO_ID_LENGTH);
    case "Y": return String(now.getFullYear());
    case "y": return pad(now.getFullYear() % 100);
    case "m": return pad(now.getMonth() + 1);
    case "d": return pad(now.getDate());
    case "h": return pad(now.getHours());
    case "i": return pad(now.getMinutes());
    case "s": return pad(now.getSeconds());
    case "ms": return pad(now.getMilliseconds(), 3);
    case "timestamp": return String(now.getTime());
    case "timestampS": return String(Math.floor(now.getTime() / 1000));
    case "uuid": return crypto.randomUUID();
  }
  const length = Number(STRING_PATTERN.exec(name)?.[1] ?? 0);
  return length >= 1 && length <= 32 ? randomString(length) : null;
};

// Longest value each placeholder can expand to (years beyond 9999 are not considered).
const maxPlaceholderLength = (name: string) => {
  switch (name) {
    case "memoId": return IMGBED_MAX_MEMO_ID_LENGTH;
    case "Y": return 4;
    case "ms": return 3;
    case "timestamp": return 13;
    case "timestampS": return 10;
    case "uuid": return 36;
  }
  const length = Number(STRING_PATTERN.exec(name)?.[1] ?? 0);
  return length || 2;
};

const normalizeFolder = (value: string) => value.split("/").map((segment) => segment.trim())
  .filter((segment) => segment && segment !== "." && segment !== "..").join("/");

// Validates against the longest possible expansion, so a folder that passes the
// connection test (where {memoId} is empty) cannot exceed the limit on a real upload.
export const imgBedFolderError = (template: string): ImgBedFolderError | null => {
  const literal = template.replace(/\{([^{}]*)\}/g, (_match, name: string) => placeholderValue(name, new Date(0)) === null ? "\u0000" : "");
  if (literal.includes("\u0000") || /[{}]/.test(literal)) return "placeholder";
  if (INVALID_FOLDER_CHARACTERS.test(literal)) return "characters";
  const longest = template.replace(/\{([^{}]*)\}/g, (_match, name: string) => "x".repeat(maxPlaceholderLength(name)));
  if (longest.length > IMGBED_MAX_FOLDER_LENGTH) return "length";
  return null;
};

export const expandImgBedFolder = (template: string, now = new Date(), context: ImgBedFolderContext = {}) => {
  const error = imgBedFolderError(template);
  if (error) throw new Error(`ImgBed upload folder is invalid: ${error}`);
  return normalizeFolder(template.replace(/\{([^{}]*)\}/g, (_match, name: string) => placeholderValue(name, now, context) ?? ""));
};
