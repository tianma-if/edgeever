import { getMemoDisplayTitle } from "@edgeever/shared/memo-title";
import { isValidMemoShareSlug } from "@edgeever/shared/share-slug";
import { PUBLIC_PAGE_HEADERS, PUBLIC_PAGE_ROBOTS } from "@edgeever/shared/public-page-headers";
import { isMemoShareExpired, recordMemoShareView } from "./memo-share-access";
import type { DatabaseAdapter } from "./storage-contract";

const SHARE_PAGE_PATH = /^\/share\/([^/]+?)(\.md)?\/?$/;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type SharePageRow = {
  title: string | null;
  content_markdown: string | null;
  password_hash: string | null;
  expires_at: string | null;
  updated_at: string;
  show_updated_at: number;
  show_branding: number;
};

export type PublicMemoSharePageTarget = {
  /** The random token, or a custom address already lowercased. */
  segment: string;
  markdown: boolean;
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
})[char]!);

/**
 * A public link segment is either the case-sensitive random token or a custom
 * address. Only the custom address is lowercased, so `/share/Meeting-Notes`
 * opens the saved `meeting-notes`.
 */
export const normalizeMemoSharePathSegment = (value: string) => {
  const segment = value.trim();
  if (SHARE_TOKEN_PATTERN.test(segment)) return segment;
  const slug = segment.toLowerCase();
  return isValidMemoShareSlug(slug) ? slug : null;
};

/** Resolves a public link segment to the share token, or null when nothing matches. */
export const resolveMemoShareToken = async (db: DatabaseAdapter, value: string) => {
  const segment = normalizeMemoSharePathSegment(value);
  if (!segment || SHARE_TOKEN_PATTERN.test(segment)) return segment;
  const row = await db.prepare(
    `SELECT token FROM memo_shares WHERE slug = ? LIMIT 1`,
  ).bind(segment).first<{ token: string }>();
  return row?.token ?? null;
};

/** Single-note public links. Notebook sites stay on their own renderer. */
export const parsePublicMemoSharePagePath = (pathname: string): PublicMemoSharePageTarget | null => {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = SHARE_PAGE_PATH.exec(path);
  const segment = match?.[1] ? normalizeMemoSharePathSegment(match[1]) : null;
  if (!segment) return null;
  return { segment, markdown: match![2] === ".md" };
};

export const isPublicMemoSharePagePath = (pathname: string) => parsePublicMemoSharePagePath(pathname) !== null;

const prefersMarkdown = (accept: string | null, markdownPath: boolean) => {
  if (markdownPath) return true;
  if (!accept || !/text\/markdown/i.test(accept)) return false;
  return !/text\/html/i.test(accept);
};

const describeNote = (markdown: string) => {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  if (!normalized) return "Read a shared note on EdgeEver.";
  return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized;
};

export const PUBLIC_SHARE_MARKDOWN_NOT_FOUND = "Shared note not found\n";
export const PUBLIC_SHARE_MARKDOWN_PASSWORD = "This shared note requires a password.\n";
export const PUBLIC_SHARE_MARKDOWN_EXPIRED = "This shared link has expired.\n";

/** Markdown body for a public note. A title already used as the first heading is kept once. */
export const publicShareMarkdown = (title: string | null, body: string) => {
  // The stored zh-CN default title means "untitled"; it is not a heading.
  const heading = getMemoDisplayTitle(title, "").replace(/[\r\n]+/g, " ").trim();
  if (!heading) return body;
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.replace(/^#\s+/, "").trim() === heading) return body;
  return body ? `# ${heading}\n\n${body}` : `# ${heading}\n`;
};

const loadShare = (db: DatabaseAdapter, token: string) => db.prepare(
  `SELECT m.title, mc.content_markdown, ms.password_hash, ms.expires_at, m.updated_at, ms.show_updated_at, ms.show_branding
   FROM memo_shares ms
   INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
   INNER JOIN memo_contents mc ON mc.memo_id = m.id
   WHERE ms.token = ? AND m.is_deleted = 0
   LIMIT 1`,
).bind(token).first<SharePageRow>();

const pageHeaders = (contentType: string) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(key, value);
  headers.set("Content-Type", contentType);
  headers.set("Vary", "Accept");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
};

const injectArticle = (html: string, article: string) => {
  if (!article) return html;
  let injected = false;
  const withRoot = html.replace(/<div\b([^>]*\bid=["']root["'][^>]*)>\s*<\/div>/i, (_match, attrs: string) => {
    injected = true;
    return `<div${attrs}>${article}</div>`;
  });
  if (injected) return withRoot;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, () => `${article}</body>`);
  return `${html}${article}`;
};

/**
 * The share URL is what people paste to an assistant. Browsers still receive
 * the app shell and replace `#root`. A fetch that does not run JavaScript
 * reads the note from this first response, or from the `.md` alternate.
 * Password-protected notes stay out of both representations.
 */
export const renderPublicMemoSharePage = async (
  request: Request,
  db: DatabaseAdapter,
  loadTemplate: () => Promise<Response>,
): Promise<Response | null> => {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const target = parsePublicMemoSharePagePath(url.pathname);
  if (!target) return null;

  const token = await resolveMemoShareToken(db, target.segment);
  const row = token ? await loadShare(db, token) : null;
  const expired = Boolean(row) && isMemoShareExpired(row?.expires_at);
  const locked = !expired && Boolean(row?.password_hash);
  const readable = Boolean(row) && !expired && !locked;
  const body = row?.content_markdown ?? "";
  const markdownUrl = `${url.origin}/share/${encodeURIComponent(target.segment)}.md`;
  const canonical = `${url.origin}/share/${encodeURIComponent(target.segment)}`;

  if (prefersMarkdown(request.headers.get("accept"), target.markdown)) {
    const headers = pageHeaders("text/markdown; charset=utf-8");
    if (!row) {
      return new Response(request.method === "HEAD" ? null : PUBLIC_SHARE_MARKDOWN_NOT_FOUND, { status: 404, headers });
    }
    if (expired) {
      return new Response(request.method === "HEAD" ? null : PUBLIC_SHARE_MARKDOWN_EXPIRED, { status: 410, headers });
    }
    if (locked) {
      return new Response(request.method === "HEAD" ? null : PUBLIC_SHARE_MARKDOWN_PASSWORD, { status: 403, headers });
    }
    // The HTML shell below is not counted: a browser opening it counts once through the share API.
    if (request.method === "GET" && token) await recordMemoShareView(db, token);
    headers.set("Content-Disposition", "inline");
    return new Response(request.method === "HEAD" ? null : publicShareMarkdown(row.title, body), { status: 200, headers });
  }

  const title = readable ? (getMemoDisplayTitle(row?.title, "").replace(/[\r\n]+/g, " ").trim() || "Shared note") : "Shared note";
  const description = readable
    ? describeNote(body)
    : expired
      ? "This shared link has expired."
      : locked
        ? "This shared note requires a password."
        : "Read a shared note on EdgeEver.";
  const updatedTime = readable && row && row.show_updated_at !== 0
    ? `<p style="font-size:.75rem;color:#64748b">Updated <time datetime="${escapeHtml(row.updated_at)}">${escapeHtml(new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(row.updated_at)))} UTC</time></p>`
    : "";
  const branding = readable && row && row.show_branding !== 0
    ? `<footer style="margin-top:2rem;font-size:.75rem;text-align:center;color:#64748b"><a href="https://edgeever.org/" style="color:inherit">Published with EdgeEver</a></footer>`
    : "";
  const article = readable
    ? `<article id="edgeever-shared-note" style="max-width:44rem;margin:1.5rem auto;padding:0 1rem"><h1>${escapeHtml(title)}</h1>${updatedTime}<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(body)}</pre>${branding}</article>`
    : "";
  const metadata = `<title>${escapeHtml(`${title} · EdgeEver`)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${PUBLIC_PAGE_ROBOTS}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${readable ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}">` : ""}
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">`;

  const template = await loadTemplate();
  if (!template.ok) return template;
  const html = injectArticle(
    (await template.text())
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
      .replace(/<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
      .replace(/<link\b[^>]*rel=["'](?:canonical|alternate)["'][^>]*>/gi, "")
      .replace(/<\/head>/i, () => `${metadata}</head>`),
    article,
  );
  const headers = new Headers(template.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Content-Encoding");
  headers.delete("Last-Modified");
  headers.delete("Age");
  headers.delete("CF-Cache-Status");
  for (const [key, value] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(key, value);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Vary", "Accept");
  headers.set("X-Content-Type-Options", "nosniff");
  if (readable) headers.set("Link", `<${markdownUrl}>; rel="alternate"; type="text/markdown"`);
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
};
