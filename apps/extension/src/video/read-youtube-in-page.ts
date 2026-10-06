import { pickYouTubeCaptionTrack, youtubeCaptionTracks } from "./youtube";

export type YouTubePageRead =
  | { ok: false; reason: "unsupported" | "not-found" }
  | {
    ok: true;
    playerResponse: unknown;
    subtitleBody: string | null;
    subtitleFormat: "json3" | "xml" | null;
    trackKind?: string;
    thumbnail?: { base64: string; mimeType: string };
  };

export const isYouTubePageRead = (value: unknown): value is YouTubePageRead => {
  if (!value || typeof value !== "object") return false;
  const record = value as { ok?: unknown; reason?: unknown; playerResponse?: unknown };
  if (record.ok === false) return record.reason === "unsupported" || record.reason === "not-found";
  return record.ok === true && "playerResponse" in record;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Runs in the page main world after the click. Chrome serializes this function
// alone, so the helpers stay nested and the subtitle URL is fetched here.
export async function readYouTubeVideoInPage(uiLanguage: string): Promise<YouTubePageRead> {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

  const videoIdOf = (response: unknown) => {
    const id = asRecord(asRecord(response)?.videoDetails)?.videoId;
    return typeof id === "string" && VIDEO_ID.test(id) ? id : "";
  };

  const videoIdFromLocation = (href: string) => {
    try {
      const url = new URL(href);
      const host = url.hostname.toLowerCase();
      if (host === "music.youtube.com" || host === "www.youtube-nocookie.com") return "";
      if (host === "youtu.be" || host === "www.youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
        return VIDEO_ID.test(id) ? id : "";
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && VIDEO_ID.test(parts[1] ?? "")) return parts[1] ?? "";
      if (parts[0] === "watch") {
        const id = url.searchParams.get("v") ?? "";
        return VIDEO_ID.test(id) ? id : "";
      }
      return "";
    } catch {
      return "";
    }
  };

  const livePlayback = (response: unknown) => {
    const details = asRecord(asRecord(response)?.videoDetails);
    if (!details) return false;
    if (details.isLive === true || details.isUpcoming === true) return true;
    if (asRecord(asRecord(response)?.playabilityStatus)?.status === "LIVE_STREAM_OFFLINE") return true;
    const micro = asRecord(asRecord(asRecord(response)?.microformat)?.playerMicroformatRenderer);
    return asRecord(micro?.liveBroadcastDetails)?.isLiveNow === true;
  };

  const currentPlayerResponse = () => {
    const elements = [
      document.getElementById("movie_player"),
      document.getElementById("shorts-player"),
      document.querySelector(".html5-video-player"),
    ];
    for (const element of elements) {
      const player = element as { getPlayerResponse?: () => unknown } | null;
      if (!player || typeof player.getPlayerResponse !== "function") continue;
      try {
        const response = player.getPlayerResponse();
        if (videoIdOf(response)) return response;
      } catch {
        // The player can throw while a new video is attaching.
      }
    }
    const initial = (window as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
    const initialId = videoIdOf(initial);
    const pageId = videoIdFromLocation(location.href);
    if (!initialId || (pageId && initialId !== pageId)) return null;
    return initial;
  };

  const tracksOf = (response: unknown) => {
    const renderer = asRecord(asRecord(asRecord(response)?.captions)?.playerCaptionsTracklistRenderer);
    const list = renderer?.captionTracks;
    if (!Array.isArray(list)) return [];
    const tracks: { baseUrl: string; languageCode: string; kind?: string; human: boolean }[] = [];
    for (const item of list) {
      const track = asRecord(item);
      const baseUrl = typeof track?.baseUrl === "string" ? track.baseUrl : "";
      const languageCode = typeof track?.languageCode === "string" ? track.languageCode : "";
      if (!baseUrl || !languageCode) continue;
      const kind = typeof track?.kind === "string" ? track.kind : undefined;
      tracks.push({ baseUrl, languageCode, ...(kind ? { kind } : {}), human: kind !== "asr" });
    }
    return tracks;
  };

  const languageFamily = (code: string) => {
    const normalized = code.trim().toLowerCase().replace(/_/g, "-");
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("en")) return "en";
    if (normalized.startsWith("ja")) return "ja";
    return normalized.split("-")[0] ?? "";
  };

  const pickTrack = (tracks: { baseUrl: string; languageCode: string; kind?: string; human: boolean }[]) => {
    const family = languageFamily(uiLanguage);
    const ranked = tracks.map((track, index) => {
      const matches = Boolean(family) && languageFamily(track.languageCode) === family;
      const rank = matches && track.human ? 0 : matches ? 1 : track.human ? 2 : 3;
      return { track, rank, index };
    });
    ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);
    return ranked[0]?.track ?? null;
  };

  const fetchText = async (url: string) => {
    const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return "";
    return response.text();
  };

  const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = "";
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }
    return btoa(binary);
  };

  const thumbnailOf = async (response: unknown) => {
    const thumbs = asRecord(asRecord(asRecord(response)?.videoDetails)?.thumbnail)?.thumbnails;
    if (!Array.isArray(thumbs)) return undefined;
    let best = "";
    let width = -1;
    for (const item of thumbs) {
      const thumb = asRecord(item);
      const url = typeof thumb?.url === "string" ? thumb.url : "";
      const size = typeof thumb?.width === "number" ? thumb.width : 0;
      if (!url || size < width) continue;
      best = url;
      width = size;
    }
    if (!best) return undefined;
    try {
      const absolute = best.startsWith("//") ? `https:${best}` : best;
      const response = await fetch(absolute, { credentials: "include", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return undefined;
      const mimeType = (response.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!mimeType.startsWith("image/")) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) return undefined;
      return { base64: bytesToBase64(bytes), mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType };
    } catch {
      return undefined;
    }
  };

  const slim = (response: unknown) => {
    const record = asRecord(response);
    if (!record) return response;
    const copy = { ...record };
    delete copy.streamingData;
    delete copy.playbackTracking;
    delete copy.attestation;
    delete copy.playerConfig;
    delete copy.ads;
    return copy;
  };

  try {
    const response = currentPlayerResponse();
    if (!response) return { ok: false, reason: "not-found" };
    if (livePlayback(response)) return { ok: false, reason: "unsupported" };
    const track = pickTrack(tracksOf(response));
    let subtitleBody: string | null = null;
    let subtitleFormat: "json3" | "xml" | null = null;
    if (track?.baseUrl) {
      try {
        const jsonUrl = new URL(track.baseUrl);
        jsonUrl.searchParams.set("fmt", "json3");
        const jsonBody = await fetchText(jsonUrl.toString());
        if (jsonBody.trim().startsWith("{")) {
          subtitleBody = jsonBody;
          subtitleFormat = "json3";
        }
      } catch {
        subtitleBody = null;
      }
      if (!subtitleBody) {
        try {
          const xmlBody = await fetchText(track.baseUrl);
          if (xmlBody.includes("<text")) {
            subtitleBody = xmlBody;
            subtitleFormat = "xml";
          }
        } catch {
          subtitleBody = null;
        }
      }
    }
    const thumbnail = await thumbnailOf(response);
    return {
      ok: true,
      playerResponse: slim(response),
      subtitleBody,
      subtitleFormat,
      ...(track?.kind ? { trackKind: track.kind } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    };
  } catch {
    return { ok: false, reason: "not-found" };
  }
}

export const chosenYouTubeTrack = (response: unknown, uiLanguage: string) =>
  pickYouTubeCaptionTrack(youtubeCaptionTracks(response), uiLanguage);
