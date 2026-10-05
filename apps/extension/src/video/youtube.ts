import { imageFromBase64, type StoredImage } from "../image-clip";
import { cleanCues, pickSubtitleTrack } from "./transcript";
import type { SubtitleOrigin, TranscriptCue, VideoCapture, VideoChapter } from "./types";

export type YouTubeReadSuccess = {
  playerResponse: unknown;
  subtitleBody: string | null;
  subtitleFormat: "json3" | "xml" | null;
  trackKind?: string;
  thumbnail?: { base64: string; mimeType: string };
};

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type YouTubeTarget = { videoId: string; kind: "watch" | "shorts" };

export type YouTubeCaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  human: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const textOf = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.simpleText === "string") return record.simpleText.trim();
  if (typeof record.text === "string") return record.text.trim();
  if (!Array.isArray(record.runs)) return "";
  return record.runs.map((run) => textOf(run)).join("").trim();
};

export const youtubeTargetFromUrl = (value: string): YouTubeTarget | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "music.youtube.com" || host === "www.youtube-nocookie.com") return null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = parts[0] ?? "";
    if (parts.length !== 1 || !VIDEO_ID.test(videoId)) return null;
    return { videoId, kind: "watch" };
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" && parts.length === 2 && VIDEO_ID.test(parts[1] ?? "")) {
    return { videoId: parts[1] ?? "", kind: "shorts" };
  }
  if (parts[0] === "watch" && parts.length === 1) {
    const videoId = url.searchParams.get("v") ?? "";
    if (!VIDEO_ID.test(videoId)) return null;
    return { videoId, kind: "watch" };
  }
  return null;
};

export const youtubeSourceUrl = (target: YouTubeTarget) => target.kind === "shorts"
  ? `https://www.youtube.com/shorts/${target.videoId}`
  : `https://www.youtube.com/watch?v=${target.videoId}`;

export const youtubeTimestampUrl = (target: YouTubeTarget, seconds: number) => {
  const time = Math.max(0, Math.floor(seconds));
  return target.kind === "shorts"
    ? `https://www.youtube.com/shorts/${target.videoId}?t=${time}`
    : `https://www.youtube.com/watch?v=${target.videoId}&t=${time}s`;
};

export const isUnsupportedYouTubePlayback = (response: unknown) => {
  const root = asRecord(response);
  const details = asRecord(root?.videoDetails);
  if (!details) return false;
  if (details.isLive === true || details.isUpcoming === true) return true;
  const playability = asRecord(root?.playabilityStatus);
  if (playability?.status === "LIVE_STREAM_OFFLINE") return true;
  const micro = asRecord(asRecord(root?.microformat)?.playerMicroformatRenderer);
  const live = asRecord(micro?.liveBroadcastDetails);
  return live?.isLiveNow === true;
};

export const youtubeCaptionTracks = (response: unknown): YouTubeCaptionTrack[] => {
  const renderer = asRecord(asRecord(asRecord(response)?.captions)?.playerCaptionsTracklistRenderer);
  const tracks = renderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  const parsed: YouTubeCaptionTrack[] = [];
  for (const track of tracks) {
    const record = asRecord(track);
    const baseUrl = typeof record?.baseUrl === "string" ? record.baseUrl : "";
    const languageCode = typeof record?.languageCode === "string" ? record.languageCode : "";
    if (!baseUrl || !languageCode) continue;
    const kind = typeof record?.kind === "string" ? record.kind : undefined;
    parsed.push({
      baseUrl,
      languageCode,
      ...(kind ? { kind } : {}),
      human: kind !== "asr",
    });
  }
  return parsed;
};

export const pickYouTubeCaptionTrack = (tracks: YouTubeCaptionTrack[], uiLanguage: string) =>
  pickSubtitleTrack(tracks, uiLanguage, (track) => ({ language: track.languageCode, human: track.human }));

export const cuesFromYouTubeJson3 = (payload: unknown): TranscriptCue[] => {
  const events = asRecord(payload)?.events;
  if (!Array.isArray(events)) return [];
  const cues: TranscriptCue[] = [];
  for (const event of events) {
    const record = asRecord(event);
    if (!record || !Array.isArray(record.segs)) continue;
    const startMs = typeof record.tStartMs === "number" ? record.tStartMs : 0;
    const durationMs = typeof record.dDurationMs === "number" ? record.dDurationMs : 0;
    let text = "";
    for (const segment of record.segs) {
      const utf8 = asRecord(segment)?.utf8;
      if (typeof utf8 === "string") text += utf8;
    }
    if (!text.replace(/\s/g, "")) continue;
    cues.push({
      start: Math.max(0, startMs) / 1000,
      end: Math.max(0, startMs + Math.max(0, durationMs)) / 1000,
      text,
    });
  }
  return cues;
};

export const cuesFromYouTubeXml = (xml: string): TranscriptCue[] => {
  const cues: TranscriptCue[] = [];
  const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  for (const match of xml.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const start = Number(/start="([^"]+)"/.exec(attrs)?.[1] ?? "");
    const duration = Number(/dur="([^"]+)"/.exec(attrs)?.[1] ?? "0");
    if (!Number.isFinite(start)) continue;
    cues.push({
      start,
      end: start + (Number.isFinite(duration) ? Math.max(0, duration) : 0),
      text: match[2] ?? "",
    });
  }
  return cues;
};

export const cuesFromYouTubeSubtitle = (body: string, format: "json3" | "xml" | null) => {
  if (!body.trim()) return [];
  if (format !== "xml") {
    try {
      const cues = cleanCues(cuesFromYouTubeJson3(JSON.parse(body) as unknown));
      if (cues.length || format === "json3") return cues;
    } catch {
      // The timedtext endpoint sometimes ignores fmt and returns XML.
    }
  }
  return cleanCues(cuesFromYouTubeXml(body));
};

const pushChapter = (chapters: VideoChapter[], seen: Set<number>, startSeconds: number, title: string) => {
  const start = Math.floor(startSeconds);
  const clean = title.replace(/\s+/g, " ").trim();
  if (!Number.isFinite(start) || start < 0 || !clean || seen.has(start)) return;
  seen.add(start);
  chapters.push({ start, title: clean });
};

export const extractYouTubeChapters = (response: unknown): VideoChapter[] => {
  const chapters: VideoChapter[] = [];
  const seen = new Set<number>();
  const seenNodes = new WeakSet<object>();
  const queue: { value: unknown; depth: number }[] = [{ value: response, depth: 0 }];
  let budget = 5000;
  while (queue.length && budget > 0) {
    budget -= 1;
    const current = queue.pop();
    if (!current || current.depth > 8 || !current.value || typeof current.value !== "object") continue;
    if (seenNodes.has(current.value)) continue;
    seenNodes.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) queue.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    const record = current.value as Record<string, unknown>;
    if (Array.isArray(record.markersMap)) {
      for (const entry of record.markersMap) {
        const list = asRecord(asRecord(entry)?.value)?.chapters;
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          const chapter = asRecord(asRecord(item)?.chapterRenderer);
          const millis = chapter?.timeRangeStartMillis;
          if (typeof millis === "number") pushChapter(chapters, seen, millis / 1000, textOf(chapter?.title));
        }
      }
    }
    const marker = asRecord(record.macroMarkersListItemRenderer);
    if (marker) {
      const seconds = asRecord(asRecord(marker.onTap)?.watchEndpoint)?.startTimeSeconds;
      if (typeof seconds === "number") pushChapter(chapters, seen, seconds, textOf(marker.title));
      else if (typeof marker.timeRangeStartMillis === "number") {
        pushChapter(chapters, seen, marker.timeRangeStartMillis / 1000, textOf(marker.title));
      }
    }
    for (const key of Object.keys(record)) queue.push({ value: record[key], depth: current.depth + 1 });
  }
  return chapters.sort((left, right) => left.start - right.start);
};

const finiteNumber = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

export const parseYouTubePlayer = (response: unknown, pageUrl: string) => {
  if (isUnsupportedYouTubePlayback(response)) return { ok: false as const, reason: "unsupported" as const };
  const details = asRecord(asRecord(response)?.videoDetails);
  const videoId = typeof details?.videoId === "string" ? details.videoId : "";
  if (!VIDEO_ID.test(videoId)) return { ok: false as const, reason: "not-found" as const };
  const hinted = youtubeTargetFromUrl(pageUrl);
  const kind = hinted?.kind ?? "watch";
  const target = { videoId, kind };
  const channelId = typeof details?.channelId === "string" ? details.channelId : "";
  const duration = Math.max(0, Math.floor(finiteNumber(details?.lengthSeconds)));
  return {
    ok: true as const,
    target,
    partial: {
      platform: "youtube" as const,
      videoId,
      title: typeof details?.title === "string" ? details.title : videoId,
      author: typeof details?.author === "string" ? details.author : "",
      ...(channelId ? { authorUrl: `https://www.youtube.com/channel/${channelId}` } : {}),
      duration,
      sourceUrl: youtubeSourceUrl(target),
      chapters: extractYouTubeChapters(response),
    },
  };
};

const thumbnailFromPage = (thumbnail: { base64: string; mimeType: string } | undefined) => {
  if (!thumbnail?.base64) return undefined;
  const image = imageFromBase64(thumbnail.base64, thumbnail.mimeType);
  if ("error" in image) return undefined;
  return image as StoredImage;
};

export const youtubeCaptureFromRead = (pageUrl: string, read: YouTubeReadSuccess): { ok: true; capture: VideoCapture } | { ok: false; reason: "unsupported" | "not-found" } => {
  const parsed = parseYouTubePlayer(read.playerResponse, pageUrl);
  if (!parsed.ok) return parsed;
  const cues = read.subtitleBody ? cuesFromYouTubeSubtitle(read.subtitleBody, read.subtitleFormat) : [];
  const origin: SubtitleOrigin | undefined = cues.length
    ? read.trackKind === "asr" ? "platform_auto" : "creator"
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
