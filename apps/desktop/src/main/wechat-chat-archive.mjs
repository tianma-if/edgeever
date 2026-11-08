import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import { renderWeChatChat, WECHAT_TRANSCRIPT_NAME, isWeChatChatFile } from "./wechat-chat-transcript.cjs";

const MAX_ENTRIES = 1000;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const readUInt16 = (bytes, offset) => {
  if (offset < 0 || offset + 2 > bytes.length) throw new WeChatArchiveError("invalid");
  return bytes.readUInt16LE(offset);
};

const readUInt32 = (bytes, offset) => {
  if (offset < 0 || offset + 4 > bytes.length) throw new WeChatArchiveError("invalid");
  return bytes.readUInt32LE(offset);
};

export class WeChatArchiveError extends Error {
  constructor(code) {
    super(code);
    this.name = "WeChatArchiveError";
    this.code = code;
  }
}

const decodeUtf8 = (bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new WeChatArchiveError("invalid");
  }
};

const assertSafeEntryName = (name) => {
  if (!name || name.includes("\\") || name.includes("\0")) throw new WeChatArchiveError("invalid");
  const parts = name.split("/");
  if (parts.some((part) => part === ".." || part === ".")) throw new WeChatArchiveError("invalid");
  if (posix.isAbsolute(name)) throw new WeChatArchiveError("invalid");
};

const readZipEntries = (bytes) => {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (data.length < 22 || data.length > MAX_EXPANDED_BYTES) throw new WeChatArchiveError("invalid");
  let end = -1;
  const earliest = Math.max(0, data.length - 22 - 65535);
  for (let offset = data.length - 22; offset >= earliest; offset -= 1) {
    if (readUInt32(data, offset) !== 0x06054b50) continue;
    if (offset + 22 + readUInt16(data, offset + 20) === data.length) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new WeChatArchiveError("invalid");
  if (readUInt16(data, end + 4) !== 0 || readUInt16(data, end + 6) !== 0) throw new WeChatArchiveError("invalid");
  const count = readUInt16(data, end + 8);
  const listed = readUInt16(data, end + 10);
  const directorySize = readUInt32(data, end + 12);
  let cursor = readUInt32(data, end + 16);
  if (count !== listed || count < 1 || count > MAX_ENTRIES || cursor + directorySize !== end) {
    throw new WeChatArchiveError("invalid");
  }

  const entries = [];
  let expandedTotal = 0;
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    if (readUInt32(data, cursor) !== 0x02014b50) throw new WeChatArchiveError("invalid");
    const flags = readUInt16(data, cursor + 8);
    const method = readUInt16(data, cursor + 10);
    const crc = readUInt32(data, cursor + 16);
    const compressedSize = readUInt32(data, cursor + 20);
    const expandedSize = readUInt32(data, cursor + 24);
    const nameLength = readUInt16(data, cursor + 28);
    const extraLength = readUInt16(data, cursor + 30);
    const commentLength = readUInt16(data, cursor + 32);
    const localOffset = readUInt32(data, cursor + 42);
    if (flags & 1 || ![0, 8].includes(method) || compressedSize === 0xffffffff || expandedSize === 0xffffffff) {
      throw new WeChatArchiveError("invalid");
    }
    const nameBytes = data.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeUtf8(nameBytes);
    assertSafeEntryName(name);
    if (seen.has(name)) throw new WeChatArchiveError("invalid");
    seen.add(name);
    expandedTotal += expandedSize;
    if (expandedTotal > MAX_EXPANDED_BYTES || localOffset >= cursor) throw new WeChatArchiveError("invalid");
    entries.push({ name, method, crc, compressedSize, expandedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new WeChatArchiveError("invalid");

  return entries.map((entry) => {
    if (entry.name.endsWith("/")) {
      if (entry.expandedSize !== 0) throw new WeChatArchiveError("invalid");
      return { name: entry.name, data: Buffer.alloc(0) };
    }
    if (readUInt32(data, entry.localOffset) !== 0x04034b50) throw new WeChatArchiveError("invalid");
    if (readUInt16(data, entry.localOffset + 8) !== entry.method) throw new WeChatArchiveError("invalid");
    const start = entry.localOffset + 30 + readUInt16(data, entry.localOffset + 26) + readUInt16(data, entry.localOffset + 28);
    const compressed = data.subarray(start, start + entry.compressedSize);
    if (compressed.length !== entry.compressedSize) throw new WeChatArchiveError("invalid");
    if (entry.method === 0 && entry.compressedSize !== entry.expandedSize) throw new WeChatArchiveError("invalid");
    let inflated;
    try {
      inflated = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.expandedSize) });
    } catch { throw new WeChatArchiveError("invalid"); }
    if (inflated.length !== entry.expandedSize || crc32(inflated) !== entry.crc) throw new WeChatArchiveError("invalid");
    return { name: entry.name, data: inflated };
  });
};

/**
 * Turn one WeChat merged-forward ZIP into a note.
 */
export const wechatChatNoteFromArchive = (bytes, archiveName = WECHAT_TRANSCRIPT_NAME) => {
  const entries = readZipEntries(bytes).filter((entry) => isWeChatChatFile(entry.name));
  const transcript = entries.find((entry) => posix.basename(entry.name) === WECHAT_TRANSCRIPT_NAME);
  if (!transcript || transcript.data.length === 0 || transcript.data.length > MAX_TEXT_BYTES) {
    throw new WeChatArchiveError("unrecognized");
  }
  let text;
  try {
    text = decodeUtf8(transcript.data).replace(/^\uFEFF/, "");
  } catch {
    throw new WeChatArchiveError("unrecognized");
  }

  const note = renderWeChatChat(text, archiveName, entries.filter((entry) => entry !== transcript && entry.data.length > 0));
  if (!note) throw new WeChatArchiveError("unrecognized");
  return {
    ...note,
    media: note.media.map(({ data, ...item }) => ({ ...item, bytes: data })),
  };
};
