import { PUBLIC_PAGE_HEADERS, PUBLIC_PAGE_ROBOTS } from "@edgeever/shared/public-page-headers";
import type { DatabaseAdapter } from "./storage-contract";
import { getNotebookSite, publicTreeSql, resolveNotebookSiteToken } from "./notebook-site-service";

export const isNotebookSitePagePath = (path: string) => /^\/(?:share\/notebook|s)\/[^/]+(?:\/[^/]+)?\/?$/.test(path);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Shared business logic; runtime adapters supply only their app-shell loader. */
export const renderNotebookSitePage = async (
  request: Request,
  db: DatabaseAdapter,
  loadTemplate: () => Promise<Response>,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!isNotebookSitePagePath(url.pathname)) return null;
  const alias = url.pathname.startsWith("/s/");
  const parts = url.pathname.split("/");
  const identity = parts[alias ? 2 : 3];
  const memoId = parts[alias ? 3 : 4];
  const resolved = alias ? await resolveNotebookSiteToken(db, identity) : { token: identity };
  const site = resolved ? await getNotebookSite(db, resolved.token) : null;
  let status = site ? 200 : 404;
  let title = "Shared notebook · EdgeEver";
  let description = "Read a shared notebook on EdgeEver.";
  let indexable = false;
  let canonical = `${url.origin}${url.pathname}`;
  let image = new URL("/apple-touch-icon.png", url).href;
  if (site && !site.password_hash) {
    const selected = memoId || site.settings.homeMemoId;
    const note = selected ? await db.prepare(`${publicTreeSql} SELECT title, excerpt FROM visible_memos WHERE id = ?`)
      .bind(site.token, selected).first<{ title: string | null; excerpt: string }>() : null;
    if (memoId && !note) status = 404;
    if (status === 200) {
      title = `${note?.title?.trim() || site.name} · EdgeEver`;
      description = note?.excerpt || site.name;
      indexable = alias && site.settings.allowIndexing;
      const base = site.site_slug ? `/s/${encodeURIComponent(site.site_slug)}` : `/share/notebook/${encodeURIComponent(site.token)}`;
      canonical = `${url.origin}${base}${memoId ? `/${encodeURIComponent(memoId)}` : ""}`;
      image = site.settings.logoUrl || image;
    }
  }
  const robots = indexable ? "index, follow" : PUBLIC_PAGE_ROBOTS;
  const metadata = `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="${memoId ? "article" : "website"}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">`;
  const template = await loadTemplate();
  if (!template.ok) return template;
  const html = (await template.text())
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<\/head>/i, () => `${metadata}</head>`);
  const headers = new Headers(template.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Content-Encoding");
  headers.delete("Last-Modified");
  headers.delete("Age");
  headers.delete("CF-Cache-Status");
  for (const [key, value] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(key, value);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Robots-Tag", robots);
  return new Response(request.method === "HEAD" ? null : html, { status, headers });
};
