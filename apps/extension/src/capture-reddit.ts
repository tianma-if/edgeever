// On-demand Reddit reader. Fetches the selected post's own JSON when Reddit
// allows it, then falls back to the selected post's DOM. Never reads comments.
(() => {
  const root = globalThis as typeof globalThis & {
    __edgeeverRedditTarget?: boolean;
    __edgeeverRedditClipPayload?: { requestId?: string; pageUrl?: string };
  };
  const payload = root.__edgeeverRedditClipPayload;
  delete root.__edgeeverRedditClipPayload;
  if (!payload || typeof payload.requestId !== "string") return;
  const finish = (result: Record<string, unknown>) => {
    void chrome.runtime.sendMessage({ type: "pageRedditRead", requestId: payload.requestId, result });
  };
  const idFromUrl = (value: string) => {
    try { return new URL(value, location.href).pathname.match(/\/comments\/([a-z0-9]+)(?=\/|$)/i)?.[1]?.toLowerCase() ?? ""; }
    catch { return ""; }
  };
  const postId = (node: Element) => {
    const direct = node.getAttribute("id")?.match(/^t3_([a-z0-9]+)$/i)?.[1]
      || node.getAttribute("data-fullname")?.match(/^t3_([a-z0-9]+)$/i)?.[1]
      || node.getAttribute("post-id")?.replace(/^t3_/, "");
    if (direct && /^[a-z0-9]+$/i.test(direct)) return direct.toLowerCase();
    return idFromUrl(node.getAttribute("permalink") || node.querySelector('a[href*="/comments/"]')?.getAttribute("href") || "");
  };
  const clean = (value: string | null | undefined) => (value || "").replace(/\u00a0/g, " ").trim();
  const selected = document.querySelector("[data-edgeever-reddit-target='1']");
  const currentId = idFromUrl(payload.pageUrl || location.href);
  const post = (selected && (!currentId || postId(selected) === currentId) ? selected : null)
    || [...document.querySelectorAll("shreddit-post, article[data-testid='post-container'], [data-testid='post-container'], .thing.link[data-fullname]")]
    .find((node) => currentId && postId(node) === currentId);
  const id = post ? postId(post) : currentId;
  if (!id || (!post && !currentId)) {
    finish({ ok: false, reason: root.__edgeeverRedditTarget ? "not-found" : "needs-listener" });
    return;
  }
  const scope = post || document;
  const ownText = (selector: string) => clean(scope.querySelector(selector)?.textContent);
  const title = clean(post?.getAttribute("post-title")) || ownText('[slot="title"], h1, h2, h3, [data-testid="post-title"]');
  const author = clean(post?.getAttribute("author")) || ownText('[data-testid="post_author_link"], a[href*="/user/"]');
  const subreddit = clean(post?.getAttribute("subreddit-prefixed-name")) || ownText('a[href^="/r/"], [data-testid="subreddit-name"]');
  const bodyNode = scope.querySelector('[slot="text-body"], [data-testid="post-content"], .md-container, .usertext-body .md, [data-click-id="text"]');
  const body = clean(bodyNode?.textContent);
  const link = clean(post?.getAttribute("content-href")) || clean(scope.querySelector('a[data-testid="outbound-link"]')?.getAttribute("href"));
  const timeNode = scope.querySelector("time[datetime], faceplate-timeago[ts]");
  const datetime = clean(timeNode?.getAttribute("datetime") || timeNode?.getAttribute("ts"));
  const images: Array<{ url: string; alt: string }> = [];
  for (const img of scope.querySelectorAll('img[src], img[data-src]')) {
    if (img.closest('shreddit-comment, [data-testid="comment"], .comment')) continue;
    const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
    try {
      const url = new URL(src, location.href);
      if (url.protocol !== "https:" || !/(^|\.)(redd\.it|redditmedia\.com)$/.test(url.hostname)) continue;
      if (/avatar|icon|emoji|award|preview\.reddit/i.test(url.pathname) && !/i\.redd\.it/.test(url.hostname)) continue;
      if (images.some((image) => image.url === url.href)) continue;
      images.push({ url: url.href, alt: clean(img.getAttribute("alt")) });
      if (images.length >= 20) break;
    } catch { /* Ignore invalid image addresses. */ }
  }
  const dom = { id, title, author, subreddit, body, externalUrl: link, datetime, images };
  void (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/comments/${id}/.json?raw_json=1&limit=0`, {
        credentials: "include", headers: { accept: "application/json" }, signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json();
        finish({ ok: true, id, api: data, dom });
        return;
      }
    } catch { /* Reddit may rate-limit or disable JSON on a page. */ }
    finally { clearTimeout(timeout); }
    finish({ ok: true, id, api: null, dom });
  })();
})();
