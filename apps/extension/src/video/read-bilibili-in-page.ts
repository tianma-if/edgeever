export type BilibiliPageRead =
  | { ok: false; reason: "unsupported" | "not-found" }
  | {
    ok: true;
    video: unknown;
    viewPoints: unknown;
    subtitleBody: string | null;
    trackLan?: string;
    thumbnail?: { base64: string; mimeType: string };
  };

export const isBilibiliPageRead = (value: unknown): value is BilibiliPageRead => {
  if (!value || typeof value !== "object") return false;
  const record = value as { ok?: unknown; reason?: unknown; video?: unknown };
  if (record.ok === false) return record.reason === "unsupported" || record.reason === "not-found";
  return record.ok === true && "video" in record;
};

// Runs in the page main world after the click. The signed player request and
// the subtitle download both happen here, before their query tokens expire.
export async function readBilibiliVideoInPage(uiLanguage: string): Promise<BilibiliPageRead> {
  const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
  ];
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

  const md5Hex = (message: string) => {
    const rotate = (value: number, shift: number) => ((value << shift) | (value >>> (32 - shift))) >>> 0;
    const add = (left: number, right: number) => (left + right) >>> 0;
    const bytes: number[] = [];
    for (let index = 0; index < message.length; index += 1) {
      const code = message.charCodeAt(index);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const lo = bitLength >>> 0;
    const hi = Math.floor(bitLength / 0x100000000);
    for (let index = 0; index < 4; index += 1) bytes.push((lo >>> (8 * index)) & 0xff);
    for (let index = 0; index < 4; index += 1) bytes.push((hi >>> (8 * index)) & 0xff);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const k = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words: number[] = [];
      for (let index = 0; index < 16; index += 1) {
        const position = offset + index * 4;
        words.push((bytes[position]! | (bytes[position + 1]! << 8) | (bytes[position + 2]! << 16) | (bytes[position + 3]! << 24)) >>> 0);
      }
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f = 0;
        let g = 0;
        if (index < 16) {
          f = (b & c) | (~b & d);
          g = index;
        } else if (index < 32) {
          f = (d & b) | (~d & c);
          g = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          g = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * index) % 16;
        }
        const next = add(b, rotate(add(add(a, f), add(k[index] ?? 0, words[g] ?? 0)), shifts[(index >> 4) * 4 + (index % 4)] ?? 0));
        a = d;
        d = c;
        c = b;
        b = next;
      }
      a0 = add(a0, a);
      b0 = add(b0, b);
      c0 = add(c0, c);
      d0 = add(d0, d);
    }
    let hex = "";
    for (const word of [a0, b0, c0, d0]) {
      for (let index = 0; index < 4; index += 1) hex += ((word >>> (8 * index)) & 0xff).toString(16).padStart(2, "0");
    }
    return hex;
  };

  const fileKey = (url: string) => {
    const cleaned = url.replace(/\\\//g, "/").replace(/\\u002F/gi, "/");
    const name = cleaned.split("?")[0]?.split("/").pop() ?? "";
    return name.split(".")[0] ?? "";
  };

  const wbiKeys = () => {
    const state = (window as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
    const direct = asRecord(state?.wbi_img);
    const imgUrl = typeof direct?.img_url === "string" ? direct.img_url : "";
    const subUrl = typeof direct?.sub_url === "string" ? direct.sub_url : "";
    if (imgUrl && subUrl) return { img: fileKey(imgUrl), sub: fileKey(subUrl) };
    if (typeof state?.wbiImgKey === "string" && typeof state.wbiSubKey === "string") {
      return { img: state.wbiImgKey, sub: state.wbiSubKey };
    }
    const scripts = document.scripts;
    for (let index = 0; index < scripts.length; index += 1) {
      const text = scripts[index]?.textContent ?? "";
      if (!text.includes("wbi") || text.length > 2_000_000) continue;
      const img = /img_url"\s*:\s*"([^"]+)"/.exec(text);
      const sub = /sub_url"\s*:\s*"([^"]+)"/.exec(text);
      if (img?.[1] && sub?.[1]) {
        const imgKey = fileKey(img[1]);
        const subKey = fileKey(sub[1]);
        if (imgKey && subKey) return { img: imgKey, sub: subKey };
      }
      const imgKey = /wbiImgKey"\s*:\s*"([A-Za-z0-9]+)"/.exec(text);
      const subKey = /wbiSubKey"\s*:\s*"([A-Za-z0-9]+)"/.exec(text);
      if (imgKey?.[1] && subKey?.[1]) return { img: imgKey[1], sub: subKey[1] };
    }
    return null;
  };

  const signQuery = (params: Record<string, string>, img: string, sub: string) => {
    const raw = img + sub;
    const mixin = mixinKeyEncTab.map((index) => raw[index] ?? "").join("").slice(0, 32);
    const wts = String(Math.round(Date.now() / 1000));
    const entries = Object.entries({ ...params, wts }).map(([key, value]) => [key, value.replace(/[!'()*]/g, "")] as const);
    entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    return `${query}&w_rid=${md5Hex(query + mixin)}`;
  };

  const languageFamily = (code: string) => {
    let normalized = code.trim().toLowerCase().replace(/_/g, "-");
    if (normalized.startsWith("ai-")) normalized = normalized.slice(3);
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("en")) return "en";
    if (normalized.startsWith("ja")) return "ja";
    return normalized.split("-")[0] ?? "";
  };

  const tracksOf = (payload: unknown) => {
    const record = asRecord(payload);
    const nested = asRecord(record?.subtitle);
    const dataSubtitle = asRecord(asRecord(record?.data)?.subtitle);
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(record?.subtitles)
        ? record.subtitles
        : nested && Array.isArray(nested.subtitles)
          ? nested.subtitles
          : dataSubtitle && Array.isArray(dataSubtitle.subtitles)
            ? dataSubtitle.subtitles
            : [];
    const tracks: { lan: string; subtitleUrl: string; human: boolean }[] = [];
    for (const item of list) {
      const record = asRecord(item);
      const lan = typeof record?.lan === "string" ? record.lan.trim() : "";
      const rawUrl = typeof record?.subtitle_url === "string" ? record.subtitle_url.trim() : "";
      const subtitleUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
      if (!lan || !/^https?:\/\//i.test(subtitleUrl)) continue;
      tracks.push({ lan, subtitleUrl, human: !lan.toLowerCase().startsWith("ai-") });
    }
    return tracks;
  };

  const pickTrack = (tracks: { lan: string; subtitleUrl: string; human: boolean }[]) => {
    const family = languageFamily(uiLanguage);
    const ranked = tracks.map((track, index) => {
      const matches = Boolean(family) && languageFamily(track.lan) === family;
      const rank = matches && track.human ? 0 : matches ? 1 : track.human ? 2 : 3;
      return { track, rank, index };
    });
    ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);
    return ranked[0]?.track ?? null;
  };

  const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = "";
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }
    return btoa(binary);
  };

  try {
    const url = new URL(location.href);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "live.bilibili.com" || parts[0] !== "video") return { ok: false, reason: "unsupported" };
    const pageRaw = Number(url.searchParams.get("p") ?? "1");
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
    const state = (window as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
    const video = asRecord(state?.videoData) ?? asRecord(state?.videoInfo);
    if (!video) return { ok: false, reason: "not-found" };
    const pages = Array.isArray(video.pages) ? video.pages : [];
    let cid = 0;
    for (const item of pages) {
      const record = asRecord(item);
      const index = Number(record?.page);
      const value = Number(record?.cid);
      if (index === page && Number.isFinite(value)) cid = value;
    }
    if (!cid && page === 1) {
      const first = asRecord(pages[0]);
      const value = Number(first?.cid);
      if (Number.isFinite(value)) cid = value;
    }
    const aid = video.aid;
    const bvid = typeof video.bvid === "string" ? video.bvid : "";
    let payload: unknown = null;
    let viewPoints: unknown = null;
    const keys = wbiKeys();
    if (keys?.img && keys.sub && cid > 0) {
      const params: Record<string, string> = { cid: String(Math.floor(cid)) };
      if (typeof aid === "number" || (typeof aid === "string" && aid)) params.aid = String(aid);
      if (bvid) params.bvid = bvid;
      try {
        const response = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${signQuery(params, keys.img, keys.sub)}`, {
          credentials: "include",
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          payload = await response.json();
          viewPoints = asRecord(asRecord(payload)?.data)?.view_points ?? null;
        }
      } catch {
        payload = null;
      }
    }
    if (!payload) payload = asRecord(video.subtitle);
    if (!viewPoints && Array.isArray(video.view_points)) viewPoints = video.view_points;
    const track = pickTrack(tracksOf(payload));
    let subtitleBody: string | null = null;
    if (track) {
      try {
        const response = await fetch(track.subtitleUrl, { credentials: "include", signal: AbortSignal.timeout(8000) });
        if (response.ok) subtitleBody = await response.text();
      } catch {
        subtitleBody = null;
      }
    }
    let thumbnail: { base64: string; mimeType: string } | undefined;
    const pic = typeof video.pic === "string" ? video.pic.trim() : "";
    const picUrl = pic.startsWith("//") ? `https:${pic}` : pic;
    if (/^https?:\/\//i.test(picUrl)) {
      try {
        const response = await fetch(picUrl, { credentials: "include", signal: AbortSignal.timeout(8000) });
        const mimeType = (response.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (response.ok && mimeType.startsWith("image/")) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > 0 && bytes.byteLength <= 2 * 1024 * 1024) {
            thumbnail = { base64: bytesToBase64(bytes), mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType };
          }
        }
      } catch {
        thumbnail = undefined;
      }
    }
    return {
      ok: true,
      video,
      viewPoints,
      subtitleBody,
      ...(track ? { trackLan: track.lan } : {}),
      ...(thumbnail ? { thumbnail } : {}),
    };
  } catch {
    return { ok: false, reason: "not-found" };
  }
}
