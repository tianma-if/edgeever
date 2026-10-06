export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface VideoChapter {
  start: number;
  title: string;
}

export type SubtitleOrigin = "creator" | "platform_auto";

export interface VideoCapture {
  platform: "youtube" | "bilibili";
  videoId: string;
  partIndex?: number;
  partTitle?: string;
  title: string;
  author: string;
  authorUrl?: string;
  duration: number;
  sourceUrl: string;
  cues: TranscriptCue[];
  subtitleOrigin?: SubtitleOrigin;
  chapters: VideoChapter[];
  thumbnail?: { bytes: Uint8Array; mimeType: string };
}

export interface VideoOutline {
  tldr: string;
  sections: { start: number; text: string }[];
  takeaways: string[];
}

export type OutlineAttempt =
  | { ok: true; outline: VideoOutline }
  | { ok: false; reason: "forbidden" | "not_configured" | "too_long" | "invalid" | "failed" };

export type VideoNoteToast =
  | "saved"
  | "transcript"
  | "transcript-scope"
  | "transcript-model"
  | "transcript-too-long"
  | "info"
  | "unsupported"
  | "not-found";
