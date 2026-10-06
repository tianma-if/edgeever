import type { TranscriptCue, VideoChapter, VideoOutline } from "./types";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

export const decodeHtmlEntities = (value: string) => value
  .replace(/&#(\d+);/g, (_, digits: string) => safeCodePoint(Number(digits)))
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
  .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);

const safeCodePoint = (value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
};

export const cleanCueText = (value: string) => decodeHtmlEntities(value)
  .replace(/\u00a0/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const cleanCues = (cues: TranscriptCue[]) => cues.flatMap((cue) => {
  const text = cleanCueText(cue.text);
  if (!text || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return [];
  const start = Math.max(0, cue.start);
  const end = Math.max(start, cue.end);
  return [{ start, end, text }];
});

export const formatTimestamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remain).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const languageFamily = (code: string) => {
  let normalized = code.trim().toLowerCase().replace(/_/g, "-");
  if (normalized.startsWith("ai-")) normalized = normalized.slice(3);
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("ja")) return "ja";
  return normalized.split("-")[0] ?? "";
};

export const pickSubtitleTrack = <T>(
  tracks: T[],
  uiLanguage: string,
  read: (track: T) => { language: string; human: boolean },
) => {
  const family = languageFamily(uiLanguage);
  const ranked = tracks.map((track, index) => {
    const info = read(track);
    const matches = Boolean(family) && languageFamily(info.language) === family;
    const rank = matches && info.human ? 0 : matches ? 1 : info.human ? 2 : 3;
    return { track, rank, index };
  });
  ranked.sort((left, right) => left.rank - right.rank || left.index - right.index);
  return ranked[0]?.track ?? null;
};

// Adjacent cues become one model block of about 30–60 seconds.
// The note transcript stays on the original cues.
export const chunkTranscript = (cues: TranscriptCue[]) => {
  const cleaned = cleanCues(cues);
  const blocks: { start: number; text: string }[] = [];
  let start = 0;
  let end = 0;
  let parts: string[] = [];
  const flush = () => {
    if (!parts.length) return;
    blocks.push({ start: Math.floor(start), text: parts.join(" ") });
    parts = [];
  };
  for (const cue of cleaned) {
    if (!parts.length) {
      start = cue.start;
      end = cue.end;
      parts = [cue.text];
      continue;
    }
    const nextEnd = Math.max(end, cue.end);
    if (nextEnd - start > 60 && end - start >= 30) {
      flush();
      start = cue.start;
      end = cue.end;
      parts = [cue.text];
      continue;
    }
    parts.push(cue.text);
    end = nextEnd;
    if (end - start >= 60) flush();
  }
  flush();
  return blocks;
};

export const snapBlockStart = (start: number, blocks: { start: number }[]) => {
  if (!Number.isFinite(start)) return null;
  let best: number | null = null;
  let distance = Infinity;
  for (const block of blocks) {
    const delta = Math.abs(start - block.start);
    if (delta <= 2 && delta < distance) {
      best = block.start;
      distance = delta;
    }
  }
  return best;
};

export const sectionsFromOutline = (
  chapters: VideoChapter[],
  outline: VideoOutline | null,
  blocks: { start: number }[],
) => {
  if (chapters.length) {
    return chapters.flatMap((chapter) => {
      const title = cleanCueText(chapter.title);
      if (!title || !Number.isFinite(chapter.start) || chapter.start < 0) return [];
      return [{ start: Math.floor(chapter.start), text: title }];
    });
  }
  if (!outline) return [];
  const used = new Set<number>();
  return outline.sections.flatMap((section) => {
    const start = snapBlockStart(section.start, blocks);
    const text = cleanCueText(section.text);
    if (start === null || !text || used.has(start)) return [];
    used.add(start);
    return [{ start, text }];
  });
};
