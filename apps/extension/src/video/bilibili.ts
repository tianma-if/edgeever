import { imageFromBase64, type StoredImage } from "../image-clip";
import { cleanCues, pickSubtitleTrack } from "./transcript";
import type { SubtitleOrigin, TranscriptCue, VideoCapture, VideoChapter } from "./types";

const BILIBILI_HOSTS = new Set(["bilibili.com", "www.bilibili.com", "m.bilibili.com"]);
const BV_ID = /^BV[0-9A-Za-z]+$/;

export type BilibiliTarget = { bvid?: string; aid?: string; page: number };

export type BilibiliSubtitleTrack = {
  lan: string;
  subtitleUrl: string;
  human: boolean;
};

export type BilibiliReadSuccess = {
  video: unknown;
  viewPoints: unknown;
  subtitleBody: string | null;
  trackLan?: string;
  thumbnail?: { base64: string; mimeType: string };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const finiteNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

export const bilibiliTargetFromUrl = (value: string): BilibiliTarget | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "live.bilibili.com" || !BILIBILI_HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "video" || parts.length !== 2) return null;
  const slug = parts[1] ?? "";
  const pageRaw = url.searchParams.get("p");
  const pageNumber = finiteNumber(pageRaw);
  const page = pageNumber !== null && pageNumber >= 1 ? Math.floor(pageNumber) : 1;
  if (BV_ID.test(slug)) return { bvid: slug, page };
  const av = /^av(\d+)$/i.exec(slug);
  if (!av?.[1]) return null;
  return { aid: av[1], page };
};

export const absoluteHttpUrl = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
};

export const bilibiliSourceUrl = (videoId: string, page: number, pageCount: number) => {
  const base = `https://www.bilibili.com/video/${videoId}`;
  return pageCount > 1 ? `${base}?p=${page}` : base;
};

export const bilibiliTimestampUrl = (videoId: string, page: number, pageCount: number, seconds: number) => {
  const time = Math.max(0, Math.floor(seconds));
  const source = bilibiliSourceUrl(videoId, page, pageCount);
  return pageCount > 1 ? `${source}&t=${time}` : `${source}?t=${time}`;
};

export type BilibiliPageInfo = { cid: number; page: number; part: string; duration: number };

export const bilibiliPages = (video: unknown): BilibiliPageInfo[] => {
  const pages = asRecord(video)?.pages;
  if (!Array.isArray(pages)) return [];
  const parsed: BilibiliPageInfo[] = [];
  for (const page of pages) {
    const record = asRecord(page);
    const cid = finiteNumber(record?.cid);
    const index = finiteNumber(record?.page);
    const duration = finiteNumber(record?.duration);
    if (cid === null || cid <= 0) continue;
    parsed.push({
      cid: Math.floor(cid),
      page: index !== null && index >= 1 ? Math.floor(index) : parsed.length + 1,
      part: typeof record?.part === "string" ? record.part.trim() : "",
      duration: duration !== null && duration > 0 ? Math.floor(duration) : 0,
    });
  }
  return parsed;
};

const subtitleArray = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  if (Array.isArray(record.subtitles)) return record.subtitles;
  const nested = asRecord(record.subtitle);
  if (nested && Array.isArray(nested.subtitles)) return nested.subtitles;
  if (nested && Array.isArray(nested.list)) return nested.list;
  const data = asRecord(record.data);
  const dataSubtitle = asRecord(data?.subtitle);
  if (dataSubtitle && Array.isArray(dataSubtitle.subtitles)) return dataSubtitle.subtitles;
  return [];
};

export const bilibiliSubtitleTracks = (payload: unknown): BilibiliSubtitleTrack[] => {
  const tracks: BilibiliSubtitleTrack[] = [];
  for (const item of subtitleArray(payload)) {
    const record = asRecord(item);
    const lan = typeof record?.lan === "string" ? record.lan.trim() : "";
    const subtitleUrl = absoluteHttpUrl(typeof record?.subtitle_url === "string" ? record.subtitle_url : "");
    if (!lan || !subtitleUrl) continue;
    tracks.push({ lan, subtitleUrl, human: !lan.toLowerCase().startsWith("ai-") });
  }
  return tracks;
};

export const pickBilibiliSubtitleTrack = (tracks: BilibiliSubtitleTrack[], uiLanguage: string) =>
  pickSubtitleTrack(tracks, uiLanguage, (track) => ({ language: track.lan, human: track.human }));

export const chaptersFromViewPoints = (points: unknown): VideoChapter[] => {
  if (!Array.isArray(points)) return [];
  const chapters: VideoChapter[] = [];
  const seen = new Set<number>();
  for (const point of points) {
    const record = asRecord(point);
    const start = finiteNumber(record?.from);
    const title = typeof record?.content === "string" ? record.content.trim() : "";
    if (start === null || start < 0 || !title) continue;
    const floored = Math.floor(start);
    if (seen.has(floored)) continue;
    seen.add(floored);
    chapters.push({ start: floored, title });
  }
  return chapters;
};

export const cuesFromBilibiliBody = (payload: unknown): TranscriptCue[] => {
  const body = asRecord(payload)?.body;
  if (!Array.isArray(body)) return [];
  const cues: TranscriptCue[] = [];
  for (const item of body) {
    const record = asRecord(item);
    const start = finiteNumber(record?.from);
    const end = finiteNumber(record?.to);
    const text = typeof record?.content === "string" ? record.content : "";
    if (start === null || end === null) continue;
    cues.push({ start, end, text });
  }
  return cues;
};

export const cuesFromBilibiliSubtitle = (body: string) => {
  if (!body.trim()) return [];
  try {
    return cleanCues(cuesFromBilibiliBody(JSON.parse(body) as unknown));
  } catch {
    return [];
  }
};

const unsupportedVideo = (video: Record<string, unknown>) => {
  const redirect = typeof video.redirect_url === "string" ? video.redirect_url : "";
  if (/bangumi|cheese|live\.bilibili\.com/i.test(redirect)) return true;
  const pages = bilibiliPages(video);
  if (pages.length > 0 && pages.every((page) => page.duration <= 0)) return true;
  return false;
};

export const parseBilibiliVideo = (video: unknown, pageUrl: string, viewPoints: unknown) => {
  const record = asRecord(video);
  if (!record) return { ok: false as const, reason: "not-found" as const };
  if (unsupportedVideo(record)) return { ok: false as const, reason: "unsupported" as const };
  const target = bilibiliTargetFromUrl(pageUrl);
  const bvid = typeof record.bvid === "string" && BV_ID.test(record.bvid) ? record.bvid : target?.bvid;
  const aidValue = finiteNumber(record.aid);
  const aid = aidValue !== null && aidValue > 0 ? String(Math.floor(aidValue)) : target?.aid;
  const videoId = bvid || (aid ? `av${aid}` : "");
  if (!videoId) return { ok: false as const, reason: "not-found" as const };
  const pages = bilibiliPages(record);
  const requested = target?.page ?? 1;
  const current = pages.find((page) => page.page === requested) ?? (requested === 1 ? pages[0] : undefined);
  if (pages.length > 0 && !current) return { ok: false as const, reason: "not-found" as const };
  const pageCount = Math.max(pages.length, 1);
  const page = current?.page ?? requested;
  const duration = current?.duration ?? Math.max(0, Math.floor(finiteNumber(record.duration) ?? 0));
  const owner = asRecord(record.owner);
  const mid = finiteNumber(owner?.mid);
  const multiple = pageCount > 1;
  return {
    ok: true as const,
    partial: {
      platform: "bilibili" as const,
      videoId,
      ...(multiple ? { partIndex: page, ...(current?.part ? { partTitle: current.part } : {}) } : {}),
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : videoId,
      author: typeof owner?.name === "string" ? owner.name.trim() : "",
      ...(mid !== null && mid > 0 ? { authorUrl: `https://space.bilibili.com/${Math.floor(mid)}` } : {}),
      duration,
      sourceUrl: bilibiliSourceUrl(videoId, page, pageCount),
      chapters: chaptersFromViewPoints(viewPoints),
    },
    page,
    pageCount,
  };
};

const thumbnailFromPage = (thumbnail: { base64: string; mimeType: string } | undefined) => {
  if (!thumbnail?.base64) return undefined;
  const image = imageFromBase64(thumbnail.base64, thumbnail.mimeType);
  if ("error" in image) return undefined;
  return image as StoredImage;
};

export const bilibiliCaptureFromRead = (pageUrl: string, read: BilibiliReadSuccess): { ok: true; capture: VideoCapture } | { ok: false; reason: "unsupported" | "not-found" } => {
  const parsed = parseBilibiliVideo(read.video, pageUrl, read.viewPoints);
  if (!parsed.ok) return parsed;
  const cues = read.subtitleBody ? cuesFromBilibiliSubtitle(read.subtitleBody) : [];
  const origin: SubtitleOrigin | undefined = cues.length
    ? read.trackLan?.toLowerCase().startsWith("ai-") ? "platform_auto" : "creator"
    : undefined;
  const thumbnail = thumbnailFromPage(read.thumbnail);
  return {
    ok: true,
    capture: {
      ...parsed.partial,
      cues,
      ...(origin ? { subtitleOrigin: origin } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    },
  };
};
