import type { ImageNoteClient } from "./image-clip";

export type RedditPost = {
  id: string;
  url: string;
  title: string;
  author: string;
  subreddit: string;
  body: string;
  externalUrl: string;
  datetime: string;
  images: Array<{ url: string; alt: string }>;
};

const redditHosts = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "sh.reddit.com"]);
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const imageUrl = (value: unknown) => {
  const raw = clean(value).replace(/&amp;/g, "&");
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)redd\.it$|(^|\.)redditmedia\.com$/.test(url.hostname) ? url.href : "";
  } catch { return ""; }
};
const externalUrl = (value: unknown) => {
  try {
    const url = new URL(clean(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
};
const isInternalRedditUrl = (value: string) => {
  try { return redditHosts.has(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
};
const label = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
const destination = (value: string) => value.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

export const redditPostIdFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (!redditHosts.has(url.hostname.toLowerCase())) return "";
    return url.pathname.match(/\/comments\/([a-z0-9]+)(?=\/|$)/i)?.[1]?.toLowerCase() ?? "";
  } catch { return ""; }
};

export const redditCanonicalUrl = (id: string, subreddit = "") => {
  if (!/^[a-z0-9]+$/i.test(id)) return "";
  const community = /^r\/[A-Za-z0-9_]+$/.test(subreddit) ? `/${subreddit}` : "";
  return `https://www.reddit.com${community}/comments/${id.toLowerCase()}/`;
};

export const redditPostFromApi = (raw: unknown, expectedId: string): RedditPost | null => {
  const listing = Array.isArray(raw) ? raw[0] : null;
  const children = listing && typeof listing === "object"
    ? (listing as { data?: { children?: unknown } }).data?.children : null;
  const first = Array.isArray(children) ? children[0] : null;
  const data = first && typeof first === "object" ? (first as { data?: Record<string, unknown> }).data : null;
  if (!data || clean(data.id).toLowerCase() !== expectedId.toLowerCase()) return null;
  const id = expectedId.toLowerCase();
  const subreddit = clean(data.subreddit) ? `r/${clean(data.subreddit)}` : "";
  const canonical = redditCanonicalUrl(id, subreddit);
  const images: RedditPost["images"] = [];
  const addImage = (url: unknown, alt = "") => {
    const normalized = imageUrl(url);
    if (normalized && !images.some((image) => image.url === normalized) && images.length < 20) {
      images.push({ url: normalized, alt });
    }
  };
  const gallery = data.gallery_data && typeof data.gallery_data === "object"
    ? data.gallery_data as { items?: Array<{ media_id?: string; caption?: string }> } : null;
  const metadata = data.media_metadata && typeof data.media_metadata === "object"
    ? data.media_metadata as Record<string, { s?: { u?: string } }> : {};
  for (const item of Array.isArray(gallery?.items) ? gallery.items : []) addImage(metadata[item.media_id ?? ""]?.s?.u, clean(item.caption));
  if (images.length === 0) addImage(data.url_overridden_by_dest);
  if (images.length === 0) {
    const preview = data.preview && typeof data.preview === "object"
      ? data.preview as { images?: Array<{ source?: { url?: string } }> } : null;
    addImage(preview?.images?.[0]?.source?.url);
  }
  const created = typeof data.created_utc === "number" && Number.isFinite(data.created_utc)
    && data.created_utc > 0 && data.created_utc < 8_640_000_000_000
    ? new Date(data.created_utc * 1000).toISOString() : "";
  const outgoing = externalUrl(data.url_overridden_by_dest);
  return {
    id, url: canonical, title: clean(data.title), author: clean(data.author), subreddit,
    body: clean(data.selftext),
    externalUrl: outgoing && !isInternalRedditUrl(outgoing) && !images.some((image) => image.url === outgoing) ? outgoing : "",
    datetime: created, images,
  };
};

export const redditPostFromDom = (raw: unknown, expectedId: string): RedditPost | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (clean(value.id).toLowerCase() !== expectedId.toLowerCase()) return null;
  const subreddit = clean(value.subreddit).match(/^r\/[A-Za-z0-9_]+$/)?.[0] ?? "";
  const images: RedditPost["images"] = [];
  if (Array.isArray(value.images)) {
    for (const item of value.images.slice(0, 20)) {
      const image = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const url = imageUrl(image.url);
      if (url && !images.some((stored) => stored.url === url)) images.push({ url, alt: clean(image.alt) });
    }
  }
  const datetime = clean(value.datetime);
  const outgoing = externalUrl(value.externalUrl);
  const post: RedditPost = {
    id: expectedId.toLowerCase(), url: redditCanonicalUrl(expectedId, subreddit),
    title: clean(value.title), author: clean(value.author).replace(/^u\//, ""), subreddit,
    body: clean(value.body),
    externalUrl: outgoing && !isInternalRedditUrl(outgoing) ? outgoing : "",
    datetime: datetime && !Number.isNaN(Date.parse(datetime)) ? new Date(datetime).toISOString() : "",
    images,
  };
  return post.title ? post : null;
};

export const redditPostMarkdown = (post: RedditPost, input: {
  sourceLabel: string; capturedAtLabel: string; timeLabel: string; authorLabel: string;
  communityLabel: string; linkLabel: string; capturedAt: string;
  uploaded?: Array<{ url: string; resourceId: string }>;
}) => {
  const parts = [`# ${post.title.replace(/[\r\n]+/g, " ").trim()}`];
  if (post.subreddit) parts.push(`${input.communityLabel}: ${post.subreddit}`);
  if (post.author) parts.push(`${input.authorLabel}: u/${post.author.replace(/^u\//, "")}`);
  if (post.body) parts.push(post.body);
  if (post.externalUrl) parts.push(`${input.linkLabel}: [${label(post.externalUrl)}](${destination(post.externalUrl)})`);
  if (post.images.length) parts.push(post.images.map((image) => {
    const resource = input.uploaded?.find((item) => item.url === image.url)?.resourceId;
    const url = resource ? `/api/v1/resources/${encodeURIComponent(resource)}/blob` : image.url;
    return `![${label(image.alt || post.title)}](${destination(url)})`;
  }).join("\n\n"));
  parts.push(`${input.sourceLabel}: [${label(post.url)}](${destination(post.url)})`);
  if (post.datetime) parts.push(`${input.timeLabel}: ${post.datetime}`);
  parts.push(`${input.capturedAtLabel}: ${input.capturedAt}`);
  return parts.join("\n\n");
};

export const saveCapturedRedditPost = async (
  client: ImageNoteClient,
  post: RedditPost,
  input: { notebookId: string; sourceLabel: string; capturedAtLabel: string; timeLabel: string; authorLabel: string;
    communityLabel: string; linkLabel: string; capturedAt: string;
    images: Array<{ url: string; bytes: Uint8Array; mimeType: string; filename: string; alt: string }> },
) => {
  const notebookId = input.notebookId || (await client.listNotebooks()).notebooks[0]?.id;
  if (!notebookId) throw new Error("no-notebook");
  const created = await client.createMemo({
    notebookId, title: post.title || `${post.subreddit} post`,
    contentMarkdown: redditPostMarkdown(post, input), tags: ["web-clip"],
  });
  const memoId = created.memo.id;
  if (!memoId) throw new Error("create-missing-id");
  const uploaded: Array<{ url: string; resourceId: string }> = [];
  for (const image of input.images) {
    try {
      const resource = await client.uploadImage(memoId, image);
      if (resource.id) uploaded.push({ url: image.url, resourceId: resource.id });
    } catch { /* Keep the remote image in the saved note. */ }
  }
  if (uploaded.length) {
    try {
      const session = await client.createEditSession(memoId);
      await client.saveMemo(memoId, {
        editSessionId: session.editSession.id,
        expectedRevision: session.editSession.baseRevision,
        expectedContentHash: session.editSession.baseContentHash,
        contentMarkdown: redditPostMarkdown(post, { ...input, uploaded }),
      });
    } catch { /* The first revision remains useful. */ }
  }
  return { memoId, resourceIds: uploaded.map((item) => item.resourceId) };
};
