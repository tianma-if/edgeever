// Remembers the exact Reddit post under the pointer. The reader runs only after
// the user chooses the context menu command. This classic content script has no imports.
(() => {
  const root = globalThis as typeof globalThis & { __edgeeverRedditTarget?: boolean };
  if (root.__edgeeverRedditTarget) return;
  root.__edgeeverRedditTarget = true;

  const idFromUrl = (value: string) => {
    try {
      return new URL(value, location.href).pathname.match(/\/comments\/([a-z0-9]+)(?=\/|$)/i)?.[1]?.toLowerCase() ?? "";
    } catch { return ""; }
  };
  const postId = (node: Element) => {
    const direct = node.getAttribute("id")?.match(/^t3_([a-z0-9]+)$/i)?.[1]
      || node.getAttribute("data-fullname")?.match(/^t3_([a-z0-9]+)$/i)?.[1]
      || node.getAttribute("post-id")?.replace(/^t3_/, "");
    if (direct && /^[a-z0-9]+$/i.test(direct)) return direct.toLowerCase();
    const permalink = node.getAttribute("permalink") || node.querySelector('a[href*="/comments/"]')?.getAttribute("href") || "";
    return idFromUrl(permalink);
  };

  document.addEventListener("contextmenu", (event) => {
    document.querySelectorAll("[data-edgeever-reddit-target]").forEach((node) => node.removeAttribute("data-edgeever-reddit-target"));
    const target = event.target instanceof Element ? event.target
      : event.target instanceof Node ? event.target.parentElement : null;
    const post = target?.closest("shreddit-post, article[data-testid='post-container'], [data-testid='post-container'], .thing.link[data-fullname]");
    if (post && postId(post)) post.setAttribute("data-edgeever-reddit-target", "1");
  }, true);
})();
