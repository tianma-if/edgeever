import { createDocument } from "@mixmark-io/domino";
import TurndownService from "turndown";
import type { ImageNoteClient } from "./image-clip";

const MAX_ZHIHU_IMAGES = 24;

export type ZhihuKind = "answer" | "article";

export type ZhihuTarget = {
  kind: ZhihuKind;
  id: string;
  questionId: string;
};

export type ZhihuLocateSuccess = {
  ok: true;
  kind: ZhihuKind;
  id: string;
  questionId: string;
  title: string;
  author: string;
  href: string;
  pageUrl: string;
  domHtml: string;
  domComplete: boolean;
};

export type ZhihuLocateFailure = {
  ok: false;
  reason: "not-found" | "needs-listener";
};

export type ZhihuLocate = ZhihuLocateSuccess | ZhihuLocateFailure;

export type ZhihuApiSuccess = {
  ok: true;
  kind: ZhihuKind;
  id: string;
  title: string;
  author: string;
  html: string;
  questionId: string;
  timeSeconds: number;
  truncated: boolean;
};

export type ZhihuApiFailure = {
  ok: false;
  reason: "unreadable";
};

export type ZhihuApiRead = ZhihuApiSuccess | ZhihuApiFailure;

export type ZhihuImageRef = {
  url: string;
  alt: string;
};

export type ResolvedZhihuNote = {
  kind: ZhihuKind;
  id: string;
  questionId: string;
  title: string;
  author: string;
  html: string;
  timeSeconds: number;
  noteUrl: string;
};

// Keep identical to targetFromLocation in capture-zhihu.ts and zhihu-target.ts.
const targetFromLocation = (hostname: string, pathname: string) => {
  const host = hostname.toLowerCase();
  const articleHost = host === "zhuanlan.zhihu.com" || host === "www.zhuanlan.zhihu.com";
  if (articleHost) {
    const article = pathname.match(/^\/p\/(\d+)(?=\/|$)/);
    if (article?.[1]) return { kind: "article" as const, id: article[1], questionId: "" };
    return null;
  }
  const zhihuHost = host === "zhihu.com" || host === "www.zhihu.com";
  if (!zhihuHost) return null;
  const answer = pathname.match(/^\/question\/(\d+)\/answer\/(\d+)(?=\/|$)/);
  if (answer?.[1] && answer?.[2]) return { kind: "answer" as const, id: answer[2], questionId: answer[1] };
  const bare = pathname.match(/^\/answer\/(\d+)(?=\/|$)/);
  if (bare?.[1]) return { kind: "answer" as const, id: bare[1], questionId: "" };
  return null;
};

const plainLine = (value: string) => value
  .replace(/\u200b/g, "")
  .replace(/[\r\n]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const decodeBasicEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&#(\d+);/g, (_match, digits: string) => {
    const code = Number(digits);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  })
  .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => {
    const code = Number.parseInt(digits, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  })
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&amp;/gi, "&");

const escapeMarkdownLabel = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

const markdownDestination = (value: string) =>
  value.replace(/\\/g, "%5C").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

const escapeImageAlt = (value: string) =>
  plainLine(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export const zhihuTargetFromPageUrl = (pageUrl: string): ZhihuTarget | null => {
  try {
    const url = new URL(pageUrl);
    return targetFromLocation(url.hostname, url.pathname);
  } catch {
    return null;
  }
};

export const questionIdFromHref = (href: string) => {
  if (!href) return "";
  try {
    const url = new URL(href, "https://www.zhihu.com");
    return url.pathname.match(/^\/question\/(\d+)(?:\/answer\/\d+)?(?=\/|$)/)?.[1] ?? "";
  } catch {
    return "";
  }
};

export const canonicalZhihuUrl = (target: ZhihuTarget) => {
  if (!/^\d+$/.test(target.id)) return "";
  if (target.kind === "article") return `https://zhuanlan.zhihu.com/p/${target.id}`;
  if (/^\d+$/.test(target.questionId)) {
    return `https://www.zhihu.com/question/${target.questionId}/answer/${target.id}`;
  }
  return `https://www.zhihu.com/answer/${target.id}`;
};

export const zhihuTimeIso = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const ms = seconds < 1e11 ? seconds * 1000 : seconds;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

export const normalizeZhihuImageUrl = (raw: string) => {
  const value = decodeBasicEntities(raw).trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.protocol === "http:") url.protocol = "https:";
    const host = url.hostname.toLowerCase();
    if (host.includes("avatar") || url.pathname.toLowerCase().includes("avatar")) return "";
    if (/\.(?:mp4|mov|m3u8|mp3)(?:$|\?)/i.test(`${url.pathname}${url.search}`)) return "";
    return url.toString();
  } catch {
    return "";
  }
};

const imageKey = (value: string) => {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/_(?:r|b|hd|qhd|\d+w)(?=\.[a-z0-9]+$)/i, "").toLowerCase();
    const host = url.hostname.toLowerCase();
    if (host === "zhimg.com" || host.endsWith(".zhimg.com")) return path;
    return `${host}${path}`;
  } catch {
    return value;
  }
};

const tagAttribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i"));
  return decodeBasicEntities(match?.[1] || match?.[2] || match?.[3] || "");
};

const unwrapEntityLinks = (html: string) => html.replace(
  /<a\b[^>]*\bclass=(?:"[^"]*\bEntityWord\b[^"]*"|'[^']*\bEntityWord\b[^']*')[^>]*>([\s\S]*?)<\/a>/gi,
  (_match, inner: string) => inner.replace(/<[^>]+>/g, ""),
);

const removeNonContent = (html: string) => html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style|svg|noscript|iframe|video|audio|canvas|button)\b[\s\S]*?<\/\1>/gi, "")
  .replace(/<(script|style|svg|noscript|iframe|video|audio|canvas|button)\b[^>]*\/?>/gi, "");

export const prepareZhihuHtml = (html: string) => {
  const images: ZhihuImageRef[] = [];
  const seen = new Set<string>();
  let next = removeNonContent(unwrapEntityLinks(html));
  next = next.replace(/<img\b[^>]*>/gi, (tag) => {
    if (images.length >= MAX_ZHIHU_IMAGES) return "";
    const raw = tagAttribute(tag, "data-original")
      || tagAttribute(tag, "data-actualsrc")
      || tagAttribute(tag, "src");
    const url = normalizeZhihuImageUrl(raw);
    if (!url) return "";
    const key = imageKey(url);
    if (seen.has(key)) return "";
    seen.add(key);
    const alt = plainLine(tagAttribute(tag, "data-caption") || tagAttribute(tag, "alt")).slice(0, 120);
    const token = `EDGEVERZHIHUIMG${images.length}`;
    images.push({ url, alt });
    return `\n\n${token}\n\n`;
  });
  return { html: next, images };
};

const normalizeMarkdown = (value: string) => value.replace(/\n{3,}/g, "\n\n").trim();

export const zhihuBodyFromHtml = (html: string, altFallback: string) => {
  const prepared = prepareZhihuHtml(html);
  // The extension background has no document. Give Turndown a parsed node so
  // its browser bundle never tries to create a document in the service worker.
  const root = createDocument(prepared.html).body;
  if (!root) throw new Error("zhihu-dom-unavailable");
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
    linkStyle: "inlined",
  });
  let markdown = normalizeMarkdown(turndown.turndown(root));
  prepared.images.forEach((image, index) => {
    const alt = escapeImageAlt(image.alt || altFallback);
    markdown = markdown.replaceAll(`EDGEVERZHIHUIMG${index}`, `![${alt}](${image.url})`);
  });
  return { markdown: normalizeMarkdown(markdown), images: prepared.images };
};

export const replaceZhihuImageUrls = (
  markdown: string,
  images: Array<{ url: string; resourceId: string }>,
) => {
  let next = markdown;
  for (const image of images) {
    if (!image.url || !image.resourceId) continue;
    const local = `/api/v1/resources/${encodeURIComponent(image.resourceId)}/blob`;
    next = next.replaceAll(`](${image.url})`, `](${local})`);
  }
  return next;
};

const isKind = (value: unknown): value is ZhihuKind => value === "answer" || value === "article";

export const isZhihuLocate = (value: unknown): value is ZhihuLocate => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ZhihuLocateSuccess> & Partial<ZhihuLocateFailure>;
  if (record.ok === false) return record.reason === "not-found" || record.reason === "needs-listener";
  if (record.ok !== true || !isKind(record.kind)) return false;
  return typeof record.id === "string"
    && typeof record.questionId === "string"
    && typeof record.title === "string"
    && typeof record.author === "string"
    && typeof record.href === "string"
    && typeof record.pageUrl === "string"
    && typeof record.domHtml === "string"
    && typeof record.domComplete === "boolean";
};

export const isZhihuApiRead = (value: unknown): value is ZhihuApiRead => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ZhihuApiSuccess> & Partial<ZhihuApiFailure>;
  if (record.ok === false) return record.reason === "unreadable";
  if (record.ok !== true || !isKind(record.kind)) return false;
  return typeof record.id === "string"
    && typeof record.title === "string"
    && typeof record.author === "string"
    && typeof record.html === "string"
    && typeof record.questionId === "string"
    && typeof record.timeSeconds === "number"
    && typeof record.truncated === "boolean";
};

export const resolveZhihuNote = (
  located: ZhihuLocateSuccess,
  api: ZhihuApiRead | null,
): ResolvedZhihuNote | null => {
  const fetched = api?.ok ? api : null;
  const apiHtml = fetched?.html.trim() ?? "";
  const domHtml = located.domComplete ? located.domHtml.trim() : "";
  const useDom = Boolean(domHtml) && (!apiHtml || Boolean(fetched?.truncated && domHtml.length > apiHtml.length));
  const html = useDom ? domHtml : apiHtml;
  const title = plainLine(fetched?.title || located.title);
  const author = plainLine(fetched?.author || located.author);
  if (!html) return null;
  const questionId = /^\d+$/.test(fetched?.questionId || "")
    ? fetched?.questionId || ""
    : located.questionId;
  const target: ZhihuTarget = { kind: located.kind, id: located.id, questionId };
  const noteUrl = canonicalZhihuUrl(target);
  if (!noteUrl) return null;
  return {
    ...target,
    title,
    author,
    html,
    timeSeconds: fetched?.timeSeconds && fetched.timeSeconds > 0 ? fetched.timeSeconds : 0,
    noteUrl,
  };
};

export const zhihuNoteTitle = (input: { title: string; author: string; body: string; fallback: string }) => {
  const heading = plainLine(input.title);
  if (heading) return heading.slice(0, 160);
  const first = input.body.split("\n").map((line) => line.replace(/^!\[[^\]]*]\([^)]*\)$/, "").trim()).find(Boolean) ?? "";
  const name = plainLine(input.author);
  const combined = name && first ? `${name}: ${first}` : (first || name || input.fallback);
  return plainLine(combined).slice(0, 160);
};

export const zhihuNoteMarkdown = (input: {
  kind: "answer" | "article";
  author: string;
  title: string;
  body: string;
  noteUrl: string;
  datetime: string;
  capturedAt: string;
  sourceLabel: string;
  capturedAtLabel: string;
  timeLabel: string;
  questionLabel: string;
  articleLabel: string;
  authorLabel: string;
  answerLabel: string;
  articleBodyLabel: string;
}) => {
  const blocks: string[] = [];
  const title = plainLine(input.title);
  const author = plainLine(input.author);
  const body = input.body.trim();
  const firstLine = body.split("\n", 1)[0]?.trim();
  const firstBreak = body.indexOf("\n");
  const contentBody = title && firstLine === title
    ? (firstBreak === -1 ? "" : body.slice(firstBreak + 1).trim())
    : body;
  if (title) blocks.push(`## ${input.kind === "answer" ? input.questionLabel : input.articleLabel}\n\n> ${title}`);
  if (author) blocks.push(`**${input.authorLabel}** ${author}`);
  if (contentBody) blocks.push(`## ${input.kind === "answer" ? input.answerLabel : input.articleBodyLabel}\n\n${contentBody}`);
  const footer = [
    input.noteUrl ? `${input.sourceLabel}: [${escapeMarkdownLabel(input.noteUrl)}](${markdownDestination(input.noteUrl)})` : "",
    input.datetime ? `${input.timeLabel}: ${input.datetime}` : "",
    `${input.capturedAtLabel}: ${input.capturedAt}`,
  ].filter(Boolean);
  blocks.push(`---\n\n${footer.join("\n\n")}`);
  return blocks.join("\n\n");
};

export const saveCapturedZhihuNote = async (
  client: ImageNoteClient,
  input: {
    kind: "answer" | "article";
    notebookId: string;
    title: string;
    author: string;
    noteTitle: string;
    body: string;
    noteUrl: string;
    datetime: string;
    images: Array<{ bytes: Uint8Array; mimeType: string; filename: string; alt: string; sourceUrl: string }>;
    capturedAt: string;
    sourceLabel: string;
    capturedAtLabel: string;
    timeLabel: string;
    questionLabel: string;
    articleLabel: string;
    authorLabel: string;
    answerLabel: string;
    articleBodyLabel: string;
  },
) => {
  let notebookId = input.notebookId;
  if (!notebookId) {
    const listed = await client.listNotebooks();
    notebookId = listed.notebooks[0]?.id ?? "";
  }
  if (!notebookId) throw new Error("no-notebook");

  const markdownFor = (uploaded: Array<{ url: string; resourceId: string }>) => zhihuNoteMarkdown({
    kind: input.kind,
    author: input.author,
    title: input.noteTitle,
    body: replaceZhihuImageUrls(input.body, uploaded),
    noteUrl: input.noteUrl,
    datetime: input.datetime,
    capturedAt: input.capturedAt,
    sourceLabel: input.sourceLabel,
    capturedAtLabel: input.capturedAtLabel,
    timeLabel: input.timeLabel,
    questionLabel: input.questionLabel,
    articleLabel: input.articleLabel,
    authorLabel: input.authorLabel,
    answerLabel: input.answerLabel,
    articleBodyLabel: input.articleBodyLabel,
  });
  const created = await client.createMemo({
    notebookId,
    title: input.title,
    contentMarkdown: markdownFor([]),
    tags: ["web-clip"],
  });
  const memoId = created.memo.id;
  if (!memoId) throw new Error("create-missing-id");
  if (input.images.length === 0) return { memoId, resourceIds: [] as string[] };

  const uploaded: Array<{ url: string; resourceId: string }> = [];
  for (const image of input.images) {
    try {
      const resource = await client.uploadImage(memoId, image);
      if (resource.id && image.sourceUrl) uploaded.push({ url: image.sourceUrl, resourceId: resource.id });
    } catch {
      // The note still keeps the remote image address when one upload fails.
    }
  }
  if (uploaded.length === 0) return { memoId, resourceIds: [] as string[] };

  try {
    const session = await client.createEditSession(memoId);
    await client.saveMemo(memoId, {
      editSessionId: session.editSession.id,
      expectedRevision: session.editSession.baseRevision,
      expectedContentHash: session.editSession.baseContentHash,
      contentMarkdown: markdownFor(uploaded),
    });
  } catch {
    // Leave the first version in place when attaching images fails.
  }
  return { memoId, resourceIds: uploaded.map((image) => image.resourceId) };
};

// Runs in the page's main world so the request uses the signed-in Zhihu session.
// Keep this function free of closures: Chrome serializes it with toString().
export async function fetchZhihuItemInPage(target: { kind?: unknown; id?: unknown }): Promise<ZhihuApiRead> {
  const asString = (value: unknown) => {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    return "";
  };
  const asNumber = (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) ? value : 0
  );
  const kind = target?.kind === "article" ? "article" : target?.kind === "answer" ? "answer" : "";
  const id = asString(target?.id);
  if (!kind || !/^\d+$/.test(id)) return { ok: false, reason: "unreadable" };
  try {
    const endpoint = kind === "article"
      ? `https://zhuanlan.zhihu.com/api/articles/${id}`
      : `/api/v4/answers/${id}?include=content,author.name,question.title,question.id,created_time,updated_time,content_need_truncated`;
    const response = await fetch(endpoint, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ok: false, reason: "unreadable" };
    const data = await response.json() as Record<string, unknown>;
    const authorRecord = data.author && typeof data.author === "object"
      ? data.author as Record<string, unknown>
      : {};
    const question = data.question && typeof data.question === "object"
      ? data.question as Record<string, unknown>
      : {};
    const updated = asNumber(data.updated_time) || asNumber(data.updated);
    const created = asNumber(data.created_time) || asNumber(data.created);
    return {
      ok: true,
      kind,
      id,
      title: asString(kind === "article" ? data.title : question.title),
      author: asString(authorRecord.name),
      html: asString(data.content),
      questionId: kind === "answer" ? asString(question.id) : "",
      timeSeconds: updated || created,
      truncated: data.content_need_truncated === true,
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
