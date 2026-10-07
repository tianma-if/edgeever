import { normalizeInstanceUrl } from "../extension";
import { chunkTranscript, formatTimestamp, sectionsFromOutline } from "./transcript";
import type {
  OutlineAttempt,
  VideoCapture,
  VideoNoteToast,
  VideoOutline,
} from "./types";

export type VideoNoteLabels = {
  source: string;
  platform: string;
  captions: string;
  capturedAt: string;
  summary: string;
  outline: string;
  takeaways: string;
  transcript: string;
  coverAlt: string;
  youtube: string;
  bilibili: string;
  captionsAuto: string;
  captionsCreator: string;
  noCaptions: string;
  fallbackTitle: string;
};

const COVER_PLACEHOLDER = "EDGEVERRESOURCEID";

export const videoNoteTitle = (title: string, fallback: string) => {
  const clean = title.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const value = clean || fallback;
  return value.length > 160 ? value.slice(0, 160).trim() : value;
};

const escapeHtmlText = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const plain = (value: string) => escapeHtmlText(value.replace(/\s+/g, " ").trim()).replace(/\]\(/g, "] (");

const linkLabel = (value: string) => plain(value).replace(/\[/g, "［").replace(/\]/g, "］");

const timestampUrl = (capture: VideoCapture, seconds: number) => {
  const time = Math.max(0, Math.floor(seconds));
  if (capture.platform === "youtube") {
    return capture.sourceUrl.includes("/shorts/")
      ? `${capture.sourceUrl}?t=${time}`
      : `${capture.sourceUrl}&t=${time}s`;
  }
  return capture.sourceUrl.includes("?")
    ? `${capture.sourceUrl}&t=${time}`
    : `${capture.sourceUrl}?t=${time}`;
};

const platformLine = (capture: VideoCapture, labels: VideoNoteLabels) => {
  const bits = [capture.platform === "bilibili" ? labels.bilibili : labels.youtube];
  if (capture.partIndex) {
    bits.push([`P${capture.partIndex}`, capture.partTitle].filter(Boolean).join(" "));
  }
  if (capture.duration > 0) bits.push(formatTimestamp(capture.duration));
  return bits.join(" · ");
};

const captionLabel = (capture: VideoCapture, labels: VideoNoteLabels) => {
  if (!capture.cues.length || !capture.subtitleOrigin) return "";
  return capture.subtitleOrigin === "platform_auto" ? labels.captionsAuto : labels.captionsCreator;
};

const bullet = (capture: VideoCapture, start: number, text: string) =>
  `- [${formatTimestamp(start)}](${timestampUrl(capture, start)}) ${plain(text)}`;

export const buildVideoNote = (input: {
  capture: VideoCapture;
  outline: VideoOutline | null;
  blocks: { start: number; text: string }[];
  labels: VideoNoteLabels;
  capturedOn: string;
  cover: "placeholder" | "none";
}) => {
  const title = videoNoteTitle(input.capture.title, input.labels.fallbackTitle);
  const sourceLabel = linkLabel([input.capture.author, title].filter(Boolean).join(" - "));
  const caption = captionLabel(input.capture, input.labels);
  const meta = [
    `> **${plain(input.labels.source)}**：[${sourceLabel}](${input.capture.sourceUrl})`,
    `> **${plain(input.labels.platform)}**：${plain(platformLine(input.capture, input.labels))}`,
  ];
  const saved = `**${plain(input.labels.capturedAt)}**：${plain(input.capturedOn)}`;
  meta.push(caption
    ? `> **${plain(input.labels.captions)}**：${plain(caption)} · ${saved}`
    : `> ${saved}`);

  const lines = [`# ${plain(title).replace(/^#+\s*/, "")}`, "", ...meta, ""];
  if (input.cover === "placeholder") {
    lines.push(`![${linkLabel(input.labels.coverAlt)}](/api/v1/resources/${COVER_PLACEHOLDER}/blob)`, "");
  }

  const sections = input.capture.cues.length
    ? sectionsFromOutline(input.capture.chapters, input.outline, input.blocks)
    : [];
  if (input.outline?.tldr && input.capture.cues.length) {
    lines.push(`## ${plain(input.labels.summary)}`, "", plain(input.outline.tldr), "");
  }
  if (sections.length) {
    lines.push(`## ${plain(input.labels.outline)}`, "", ...sections.map((section) => bullet(input.capture, section.start, section.text)), "");
  }
  if (input.outline && input.outline.takeaways.length && input.capture.cues.length) {
    lines.push(`## ${plain(input.labels.takeaways)}`, "", ...input.outline.takeaways.map((item) => `- ${plain(item)}`), "");
  }
  if (!input.capture.cues.length) {
    lines.push(plain(input.labels.noCaptions), "");
  } else {
    lines.push(
      "<details>",
      `<summary>${plain(input.labels.transcript)}</summary>`,
      "",
      ...input.capture.cues.map((cue) => bullet(input.capture, cue.start, cue.text)),
      "",
      "</details>",
      "",
    );
  }
  return { title, markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n" };
};

const usefulOutline = (outline: VideoOutline, hasChapters: boolean) => Boolean(
  outline.tldr.trim() || outline.takeaways.length || (!hasChapters && outline.sections.length),
);

export const videoNoteFromCapture = (input: {
  capture: VideoCapture;
  attempt: OutlineAttempt | null;
  labels: VideoNoteLabels;
  capturedOn: string;
  cover: "placeholder" | "none";
}) => {
  const blocks = chunkTranscript(input.capture.cues);
  let outline: VideoOutline | null = null;
  let toast: VideoNoteToast = input.capture.cues.length ? "transcript" : "info";
  if (input.capture.cues.length && input.attempt?.ok && usefulOutline(input.attempt.outline, input.capture.chapters.length > 0)) {
    outline = input.attempt.outline;
    toast = "saved";
  } else if (input.capture.cues.length && input.attempt && !input.attempt.ok) {
    toast = input.attempt.reason === "forbidden"
      ? "transcript-scope"
      : input.attempt.reason === "not_configured"
        ? "transcript-model"
        : input.attempt.reason === "too_long"
          ? "transcript-too-long"
          : "transcript";
  }
  return { ...buildVideoNote({ ...input, outline, blocks }), toast };
};

export const videoOutlineRequestBody = (capture: VideoCapture) => ({
  platform: capture.platform,
  title: videoNoteTitle(capture.title, capture.videoId),
  author: capture.author.slice(0, 200),
  duration: Math.max(0, Math.floor(capture.duration)),
  hasChapters: capture.chapters.length > 0,
  blocks: chunkTranscript(capture.cues).map((block) => ({
    start: block.start,
    text: block.text.slice(0, 8000),
  })),
});

const outlineFromJson = (value: unknown): VideoOutline | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as { tldr?: unknown; sections?: unknown; takeaways?: unknown };
  const sections = Array.isArray(record.sections)
    ? record.sections.flatMap((section) => {
      if (!section || typeof section !== "object") return [];
      const item = section as { start?: unknown; text?: unknown };
      if (typeof item.start !== "number" || typeof item.text !== "string") return [];
      return [{ start: item.start, text: item.text }];
    })
    : [];
  const takeaways = Array.isArray(record.takeaways)
    ? record.takeaways.filter((item): item is string => typeof item === "string")
    : [];
  return {
    tldr: typeof record.tldr === "string" ? record.tldr : "",
    sections,
    takeaways,
  };
};

export const postVideoOutline = async (
  settings: { instanceUrl: string; token: string },
  body: ReturnType<typeof videoOutlineRequestBody>,
): Promise<OutlineAttempt> => {
  if (!body.blocks.length) return { ok: false, reason: "failed" };
  try {
    const response = await fetch(`${normalizeInstanceUrl(settings.instanceUrl)}/api/v1/ai/video-outline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json().catch(() => null) as { error?: { code?: string }; tldr?: unknown } | null;
    if (response.ok) {
      const outline = outlineFromJson(payload);
      return outline ? { ok: true, outline } : { ok: false, reason: "invalid" };
    }
    const code = payload?.error?.code ?? "";
    if (response.status === 403) return { ok: false, reason: "forbidden" };
    if (response.status === 409 || code === "ai_not_configured") return { ok: false, reason: "not_configured" };
    if (code === "video_outline_too_long") return { ok: false, reason: "too_long" };
    if (response.status === 422) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
};

const filenameForCover = (mimeType: string) => {
  if (mimeType === "image/png") return "cover.png";
  if (mimeType === "image/webp") return "cover.webp";
  if (mimeType === "image/gif") return "cover.gif";
  return "cover.jpg";
};

export const persistVideoNote = async (input: {
  notebookId: string;
  capture: VideoCapture;
  labels: VideoNoteLabels;
  capturedOn: string;
  attempt: OutlineAttempt | null;
  createMemo: (body: { notebookId: string; title: string; contentMarkdown: string; tags: string[] }) => Promise<unknown>;
  createWithImage?: (body: {
    notebookId: string;
    title: string;
    contentMarkdown: string;
    tags: string[];
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<unknown>;
}) => {
  const withCover = Boolean(input.capture.thumbnail && input.createWithImage);
  const note = videoNoteFromCapture({
    capture: input.capture,
    attempt: input.attempt,
    labels: input.labels,
    capturedOn: input.capturedOn,
    cover: withCover ? "placeholder" : "none",
  });
  if (withCover && input.capture.thumbnail && input.createWithImage) {
    try {
      await input.createWithImage({
        notebookId: input.notebookId,
        title: note.title,
        contentMarkdown: note.markdown,
        tags: ["web-clip"],
        filename: filenameForCover(input.capture.thumbnail.mimeType),
        mimeType: input.capture.thumbnail.mimeType,
        bytes: input.capture.thumbnail.bytes,
      });
      return note;
    } catch {
      // A missing write:resources scope or a bad image still leaves the note.
    }
  }
  const plainNote = note.markdown.includes(COVER_PLACEHOLDER)
    ? videoNoteFromCapture({
      capture: input.capture,
      attempt: input.attempt,
      labels: input.labels,
      capturedOn: input.capturedOn,
      cover: "none",
    })
    : note;
  await input.createMemo({
    notebookId: input.notebookId,
    title: plainNote.title,
    contentMarkdown: plainNote.markdown,
    tags: ["web-clip"],
  });
  return plainNote;
};
