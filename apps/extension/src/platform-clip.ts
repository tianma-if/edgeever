import { clipDateTimeText } from "./clip-time";
export { clipDateTimeText } from "./clip-time";
import TurndownService from "turndown";
import { tables } from "@joplin/turndown-plugin-gfm";

export type ClipPlatform = "hacker-news" | "v2ex" | "xiaoyuzhou" | "boss" | "xueqiu" | "wechat" | "jike" | "sspai" | "juejin" | "douban" | "facebook" | "instagram" | "linkedin" | "threads" | "bluesky" | "substack-note";
export type PlatformTarget = { platform: ClipPlatform; id: string; url: string };
export type PublishedTime = { value: string; precision: "datetime" | "date" | "relative" };
export type PlatformClip = PlatformTarget & {
  title: string;
  markdown: string;
  author?: string;
  authorHeadline?: string;
  publishedAt?: PublishedTime;
  tags: string[];
  completeness: "complete" | "no-shownotes";
};
export type PlatformRead = { ok: true; clip: PlatformClip } | {
  ok: false;
  reason: "not-target" | "unreadable" | "changed" | "incomplete";
};
export type PlatformLabels = {
  score: string;
  externalLink: string;
  supplement: string;
  podcast: string;
  noShowNotes: string;
  relativeTime: string;
};

export const PLATFORM_MENUS = [
  { id: "save-hacker-news", title: "saveHackerNewsToEdgeEver", patterns: ["https://news.ycombinator.com/item?*"] },
  { id: "save-v2ex", title: "saveV2exToEdgeEver", patterns: ["https://www.v2ex.com/t/*", "https://v2ex.com/t/*"] },
  { id: "save-xiaoyuzhou", title: "saveXiaoyuzhouToEdgeEver", patterns: ["https://www.xiaoyuzhoufm.com/episode/*"] },
  { id: "save-boss", title: "saveBossToEdgeEver", patterns: ["https://www.zhipin.com/job_detail/*", "https://zhipin.com/job_detail/*"] },
  { id: "save-xueqiu", title: "saveXueqiuToEdgeEver", patterns: ["https://xueqiu.com/*", "https://www.xueqiu.com/*"] },
  { id: "save-wechat", title: "saveWechatToEdgeEver", patterns: ["https://mp.weixin.qq.com/s", "https://mp.weixin.qq.com/s?*", "https://mp.weixin.qq.com/s/*"] },
  { id: "save-jike", title: "saveJikeToEdgeEver", patterns: ["https://m.okjike.com/originalPosts/*", "https://m.okjike.com/topics/*", "https://web.okjike.com/*"] },
  { id: "save-sspai", title: "saveSspaiToEdgeEver", patterns: ["https://sspai.com/post/*", "https://www.sspai.com/post/*"] },
  { id: "save-juejin", title: "saveJuejinToEdgeEver", patterns: ["https://juejin.cn/post/*"] },
  { id: "save-douban", title: "saveDoubanToEdgeEver", patterns: ["https://book.douban.com/review/*", "https://movie.douban.com/review/*", "https://music.douban.com/review/*", "https://book.douban.com/comment/*", "https://movie.douban.com/comment/*", "https://music.douban.com/comment/*", "https://www.douban.com/note/*", "https://book.douban.com/subject/*/comments*", "https://movie.douban.com/subject/*/comments*", "https://music.douban.com/subject/*/comments*"] },
  { id: "save-facebook", title: "saveFacebookToEdgeEver", patterns: ["https://www.facebook.com/*", "https://facebook.com/*", "https://m.facebook.com/*"] },
  { id: "save-instagram", title: "saveInstagramToEdgeEver", patterns: ["https://www.instagram.com/*", "https://instagram.com/*"] },
  { id: "save-linkedin", title: "saveLinkedinToEdgeEver", patterns: ["https://www.linkedin.com/*", "https://linkedin.com/*"] },
  { id: "save-threads", title: "saveThreadsToEdgeEver", patterns: ["https://www.threads.com/*", "https://threads.com/*", "https://www.threads.net/*", "https://threads.net/*"] },
  { id: "save-bluesky", title: "saveBlueskyToEdgeEver", patterns: ["https://bsky.app/*"] },
  { id: "save-substack-note", title: "saveSubstackNoteToEdgeEver", patterns: ["https://substack.com/@*/note/*", "https://www.substack.com/@*/note/*"] },
] as const;

export const platformTarget = (pageUrl: string): PlatformTarget | null => {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "news.ycombinator.com" && url.pathname === "/item") {
    const ids = url.searchParams.getAll("id");
    if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) return null;
    return { platform: "hacker-news", id: ids[0], url: `https://news.ycombinator.com/item?id=${ids[0]}` };
  }
  if (url.hostname === "v2ex.com" || url.hostname === "www.v2ex.com") {
    const id = /^\/t\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1];
    return id ? { platform: "v2ex", id, url: `https://www.v2ex.com/t/${id}` } : null;
  }
  if (url.hostname === "www.xiaoyuzhoufm.com") {
    const id = /^\/episode\/([a-f0-9]{24})\/?$/.exec(url.pathname)?.[1];
    return id ? { platform: "xiaoyuzhou", id, url: `https://www.xiaoyuzhoufm.com/episode/${id}` } : null;
  }
  if (url.hostname === "www.zhipin.com" || url.hostname === "zhipin.com") {
    const id = /^\/job_detail\/([a-zA-Z0-9_~-]+)\.html$/.exec(url.pathname)?.[1];
    return id ? { platform: "boss", id, url: `https://www.zhipin.com/job_detail/${id}.html` } : null;
  }
  if (url.hostname === "xueqiu.com" || url.hostname === "www.xueqiu.com") {
    const match = /^\/([1-9]\d*)\/([1-9]\d*)\/?$/.exec(url.pathname);
    return match ? { platform: "xueqiu", id: `${match[1]}/${match[2]}`, url: `https://xueqiu.com/${match[1]}/${match[2]}` } : null;
  }
  if (url.hostname === "mp.weixin.qq.com") {
    const shortId = /^\/s\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    if (shortId) return { platform: "wechat", id: shortId, url: `https://mp.weixin.qq.com/s/${shortId}` };
    if (url.pathname === "/s") {
      const names = ["__biz", "mid", "idx"], values = names.map((name) => url.searchParams.get(name));
      if (names.some((name) => url.searchParams.getAll(name).length !== 1) || values.some((v) => !v)
        || !/^[1-9]\d*$/.test(values[1]!) || !/^[1-9]\d*$/.test(values[2]!)) return null;
      const canonical = new URL("https://mp.weixin.qq.com/s");
      names.forEach((name, i) => canonical.searchParams.set(name, values[i]!));
      const signatures = url.searchParams.getAll("sn");
      if (signatures.length > 1) return null;
      if (signatures[0]) canonical.searchParams.set("sn", signatures[0]);
      return { platform: "wechat", id: `${values[0]}/${values[1]}/${values[2]}`, url: canonical.href };
    }
  }
  if (url.hostname === "m.okjike.com" || url.hostname === "web.okjike.com") {
    const id = (url.hostname === "m.okjike.com" ? /^\/originalPosts\/([a-f0-9]{24})\/?$/ : /^\/originalPost\/([a-f0-9]{24})\/?$/).exec(url.pathname)?.[1]
      || (url.hostname === "web.okjike.com" ? /^\/u\/[^/]+\/post\/([a-f0-9]{24})\/?$/.exec(url.pathname)?.[1] : undefined);
    if (id) return { platform: "jike", id, url: `https://m.okjike.com/originalPosts/${id}` };
  }
  if (url.hostname === "sspai.com" || url.hostname === "www.sspai.com" || url.hostname === "juejin.cn") {
    const id = /^\/post\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1];
    if (id) {
      const platform = url.hostname === "juejin.cn" ? "juejin" : "sspai";
      return { platform, id, url: `https://${platform === "juejin" ? "juejin.cn" : "sspai.com"}/post/${id}` };
    }
  }
  if (["book.douban.com", "movie.douban.com", "music.douban.com"].includes(url.hostname)) {
    const detail = /^\/(review|comment)\/([1-9]\d*)\/?$/.exec(url.pathname);
    if (detail) return { platform: "douban", id: `${url.hostname.split(".")[0]}/${detail[1]}/${detail[2]}`, url: `https://${url.hostname}/${detail[1]}/${detail[2]}/` };
  }
  if (url.hostname === "www.douban.com") {
    const note = /^\/note\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1];
    if (note) return { platform: "douban", id: `note/${note}`, url: `https://www.douban.com/note/${note}/` };
  }
  if (url.hostname === "substack.com" || url.hostname === "www.substack.com") {
    const match = /^\/@([a-zA-Z0-9_-]+)\/note\/(c-[1-9]\d*)\/?$/.exec(url.pathname);
    if (match) return { platform: "substack-note", id: `${match[1].toLowerCase()}/${match[2]}`, url: `https://substack.com/@${match[1].toLowerCase()}/note/${match[2]}` };
  }
  if (url.hostname === "bsky.app") {
    const match = /^\/profile\/([a-zA-Z0-9.:%-]+)\/post\/([a-z2-7]{13})\/?$/.exec(url.pathname);
    if (match) return { platform: "bluesky", id: `${match[1]}/${match[2]}`, url: `https://bsky.app/profile/${match[1]}/post/${match[2]}` };
  }
  if (["threads.com", "www.threads.com", "threads.net", "www.threads.net"].includes(url.hostname)) {
    const match = /^\/@([a-zA-Z0-9._]+)\/post\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
    if (match) return { platform: "threads", id: `${match[1].toLowerCase()}/${match[2]}`, url: `https://www.threads.com/@${match[1].toLowerCase()}/post/${match[2]}` };
  }
  if (["instagram.com", "www.instagram.com"].includes(url.hostname)) {
    const code = /^\/(?:[a-zA-Z0-9._]+\/)?(?:p|reel)\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
    if (code) return { platform: "instagram", id: code, url: `https://www.instagram.com/p/${code}/` };
  }
  if (["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) {
    const match = /^\/([a-zA-Z0-9.]+)\/posts\/(?:[a-zA-Z0-9_-]+\/)?([1-9]\d*|pfbid[a-zA-Z0-9]+)\/?$/.exec(url.pathname);
    if (match) return { platform: "facebook", id: match[2], url: `https://www.facebook.com/${match[1]}/posts/${match[2]}` };
    if (["/permalink.php", "/story.php"].includes(url.pathname)) {
      const id = url.searchParams.get("story_fbid"), owner = url.searchParams.get("id");
      if (url.searchParams.getAll("story_fbid").length === 1 && url.searchParams.getAll("id").length === 1
        && id && owner && /^(?:[1-9]\d*|pfbid[a-zA-Z0-9]+)$/.test(id) && /^[1-9]\d*$/.test(owner)) {
        return { platform: "facebook", id, url: `https://www.facebook.com/${owner}/posts/${id}` };
      }
    }
  }
  if (["linkedin.com", "www.linkedin.com"].includes(url.hostname)) {
    const match = /^\/feed\/update\/urn:li:(activity|ugcPost|share):([1-9]\d*)\/?$/.exec(url.pathname)
      || /^\/posts\/[a-zA-Z0-9_-]+-(activity|ugcPost|share)-([1-9]\d*)-[a-zA-Z0-9_-]+\/?$/.exec(url.pathname);
    if (match) return { platform: "linkedin", id: match[1] === "activity" ? match[2] : `${match[1]}:${match[2]}`,
      url: `https://www.linkedin.com/feed/update/urn:li:${match[1]}:${match[2]}/` };
  }
  return null;
};

export const socialPlatform = (pageUrl: string): ClipPlatform | null => {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (["www.facebook.com", "facebook.com", "m.facebook.com"].includes(url.hostname)) return "facebook";
  if (["www.instagram.com", "instagram.com"].includes(url.hostname)) return "instagram";
  if (["www.linkedin.com", "linkedin.com"].includes(url.hostname)) return "linkedin";
  if (["www.threads.com", "threads.com", "www.threads.net", "threads.net"].includes(url.hostname)) return "threads";
  if (url.hostname === "bsky.app") return "bluesky";
  if (url.hostname === "xueqiu.com" || url.hostname === "www.xueqiu.com") return "xueqiu";
  if (url.hostname === "web.okjike.com" || (url.hostname === "m.okjike.com" && /^\/topics\/[a-f0-9]{24}\/?$/.test(url.pathname))) return "jike";
  if (["book.douban.com","movie.douban.com","music.douban.com"].includes(url.hostname) && /^\/subject\/[1-9]\d*\/comments\/?$/.test(url.pathname)) return "douban";
  return null;
};

export const platformText = (node: Node | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
/** New vertical readers must not restore content hidden by a site's CSS. */
export const platformElementHidden = (node: Element, ignoreAriaHidden = false): boolean => {
  // Unlike display:none, visibility can be restored by a descendant. The
  // browser's computed value already includes inheritance and overrides.
  let visibility = node.ownerDocument.defaultView?.getComputedStyle?.(node).visibility;
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (current.matches('[hidden]') || (!ignoreAriaHidden && current.matches('[aria-hidden="true"]'))) return true;
    const style = current.ownerDocument.defaultView?.getComputedStyle?.(current)
      || (current as HTMLElement).style;
    if (style?.display === "none") return true;
    // Domino has no computed styles; use the closest explicit inline value.
    if (!visibility && style?.visibility && style.visibility !== "inherit") visibility = style.visibility;
  }
  return visibility === "hidden" || visibility === "collapse";
};
export const platformReadableCopy = (node: Element, ignoreAriaHidden = false): Element => {
  const copy = node.cloneNode(true) as Element;
  const prune = (original: Element, cloned: Element): boolean => {
    const visible = !platformElementHidden(original, ignoreAriaHidden);
    const children = Array.from(original.childNodes), clones = Array.from(cloned.childNodes);
    let visibleDescendant = false;
    children.forEach((child, index) => {
      if (child.nodeType === 1) {
        const retained = prune(child as Element, clones[index] as Element);
        if (retained) visibleDescendant = true;
        else cloned.removeChild(clones[index]);
      } else if (!visible) cloned.removeChild(clones[index]);
    });
    return visible || visibleDescendant;
  };
  prune(node, copy);
  return copy;
};
export const markdownText = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}[\]<>])/g, "\\$1");
export const markdownUrl = (value: string) => value.replace(/[\\ ()<>]/g, (char) => encodeURIComponent(char).replace("(", "%28").replace(")", "%29"));

export const safePlatformUrl = (value: string, base: string, mailto = false) => {
  if (!value.trim()) return "";
  try {
    const url = new URL(value, base);
    return (url.protocol === "http:" || url.protocol === "https:" || (mailto && url.protocol === "mailto:"))
      && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
};

/** Keep the precision of the page's time; never substitute the capture time. */
export const publishedTime = (node: Element | null): PublishedTime | undefined => {
  if (!node) return undefined;
  const machine = (node.getAttribute("datetime") || node.getAttribute("title") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(machine)) return { value: machine, precision: "date" };
  // Preserve the source timezone here. Known site-specific conventions are
  // handled by the dedicated reader, never inferred from the device timezone.
  const normalized = machine.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/ (?=[+-]\d{2}:\d{2}$)/, "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(normalized)) {
    return { value: normalized, precision: "datetime" };
  }
  const value = platformText(node);
  return value ? { value, precision: "relative" } : undefined;
};

export const publishedTimeText = (time: PublishedTime, relativeLabel: string) =>
  time.precision === "relative" ? `${time.value} (${relativeLabel})`
    : time.precision === "datetime" ? clipDateTimeText(time.value) : time.value;

/** Sanitizes a detached copy. Links and images never keep active protocols. */
export const platformHtmlCopy = (body: Element | DocumentFragment, baseUrl: string, ignoreAriaHidden = false): Element | DocumentFragment => {
  const copy = body.cloneNode(true) as Element | DocumentFragment;
  Array.from(copy.querySelectorAll(`script, style, noscript, template, iframe, object, embed, canvas, svg, video, audio, source, link, meta, form, input, button, textarea, select, [hidden]${ignoreAriaHidden ? "" : ", [aria-hidden='true']"}`))
    .forEach((node) => node.remove());
  for (const node of Array.from(copy.querySelectorAll("*"))) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || attribute.name === "style") node.removeAttribute(attribute.name);
    }
  }
  for (const link of Array.from(copy.querySelectorAll("a"))) {
    const url = safePlatformUrl(link.getAttribute("href") || "", baseUrl, true);
    if (url) link.setAttribute("href", markdownUrl(url));
    else link.removeAttribute("href");
  }
  for (const img of Array.from(copy.querySelectorAll("img"))) {
    const url = ["data-original", "data-src", "src"].map((name) => safePlatformUrl(img.getAttribute(name) || "", baseUrl)).find(Boolean);
    if (url) img.setAttribute("src", markdownUrl(url));
    else img.remove();
    img.removeAttribute("srcset");
  }
  return copy;
};

export const platformHtmlMarkdown = (body: Element | DocumentFragment, baseUrl: string, ignoreAriaHidden = false): string => {
  const copy = body.ownerDocument.createElement("div");
  copy.appendChild(platformHtmlCopy(body, baseUrl, ignoreAriaHidden));
  for(const table of Array.from(copy.querySelectorAll("table"))) {
    const head=Array.from(table.children).find(node=>node.tagName === "THEAD");
    // Expand spans on the detached copy so cells keep their columns. Vertical
    // spans repeat their value within the original HTML row group; horizontal
    // spans retain the value followed by empty cells, as GFM has no merges.
    if(table.querySelector("[rowspan],[colspan]")) {
      const rows=Array.from(table.querySelectorAll("tr")).filter(row=>row.closest("table") === table);
      const grid: Element[][]=rows.map(()=>[]);
      rows.forEach((row,index)=>{
        let column=0;
        let groupEnd=index+1;
        while(groupEnd<rows.length && rows[groupEnd].parentElement === row.parentElement) groupEnd++;
        for(const cell of Array.from(row.children).filter(node=>/^(TD|TH)$/.test(node.tagName))) {
          while(grid[index][column] !== undefined) column++;
          const width=(cell as HTMLTableCellElement).colSpan || 1;
          const height=cell.getAttribute("rowspan") === "0" ? groupEnd-index : (cell as HTMLTableCellElement).rowSpan || 1;
          for(let next=index;next<Math.min(groupEnd,index+height);next++) {
            grid[next][column]=next===index ? cell : cell.cloneNode(true) as Element;
            grid[next][column].removeAttribute("rowspan");grid[next][column].removeAttribute("colspan");
            for(let offset=1;offset<width;offset++) grid[next][column+offset]=body.ownerDocument.createElement(cell.tagName.toLowerCase());
          }
          column+=width;
        }
      });
      rows.forEach((row,index)=>{
        while(row.firstChild) row.removeChild(row.firstChild);
        for(let column=0;column<grid[index].length;column++) {
          row.appendChild(grid[index][column] || body.ownerDocument.createElement("td"));
        }
      });
    }
    // GFM has one header row; additional HTML header rows remain data.
    if(head) {
      let previous: Element=head;
      for(const row of Array.from(head.children).slice(1)) {table.insertBefore(row,previous.nextSibling);previous=row;}
    }
  }
  // The table plugin reads captions as raw text. Convert them as normal rich
  // paragraphs so literal HTML stays escaped and links/formatting survive.
  for (const caption of Array.from(copy.querySelectorAll("table > caption"))) {
    const paragraph=body.ownerDocument.createElement("p");
    while(caption.firstChild) paragraph.appendChild(caption.firstChild);
    const table=caption.parentElement!;
    table.parentNode!.insertBefore(paragraph,table);
    caption.remove();
  }
  // EdgeEver stores Markdown, so Joplin's HTML fallback would display source
  // text. Keep the grid and use inline Markdown for rich cell contents.
  const options: TurndownService.Options & {preserveTableHtml: boolean} = { bulletListMarker: "-", codeBlockStyle: "fenced", headingStyle: "atx", linkStyle: "inlined", preserveTableHtml:false };
  const turndown = new TurndownService(options);
  turndown.use(tables);
  turndown.addRule("platformCjkStrong", {
    filter: ["strong", "b"],
    replacement: (content, node) => {
      // CommonMark cannot close emphasis after punctuation before unspaced
      // prose. Keep every character, moving only that punctuation outside bold.
      const suffix = /^[\p{L}\p{N}]/u.test(node.nextSibling?.textContent || "")
        ? content.match(/[，。！？；：、]+$/u)?.[0] || "" : "";
      const text = suffix ? content.slice(0, -suffix.length) : content;
      return text.trim() ? `**${text}**${suffix}` : content;
    },
  });
  // Escape literal text at Turndown's text boundary. Code blocks keep their
  // exact bytes, and a pasted HTML tag cannot become a note element.
  const escape=turndown.escape.bind(turndown);
  turndown.escape=(value)=>escape(value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"))
    // TipTap also recognizes alphabetic/Roman list markers, including "Dr.".
    .replace(/^([ \t]*[A-Za-z]+)([.)])(?=\s)/gm,"$1\\$2");
  const oddPipeBackslashes = (value: string) => Array.from(value.matchAll(/(\\+)\|/g)).some(match => match[1].length % 2 === 1);
  // GFM code spans cannot encode an odd backslash run before a pipe without
  // changing bytes or columns. Keep that fragment as escaped text instead.
  const tableCodeText = (value: string) => turndown.escape(value).replace(/^[ \t]+|[ \t]+$/g, space =>
    space.replace(/ /g, "&#32;").replace(/\t/g, "&#9;"));
  turndown.addRule("platformTableCode", {
    filter: node => node.nodeName === "CODE" && !!(node as HTMLElement).closest("td,th") && oddPipeBackslashes(node.textContent || ""),
    replacement: (_content, node) => tableCodeText(node.textContent || ""),
  });
  turndown.addRule("platformCode", {
    filter: "pre",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector("code");
      const language = /(?:^|\s)(?:language|lang)-([a-zA-Z0-9_+-]+)(?=\s|$)/.exec(`${code?.className ?? ""} ${element.className}`)?.[1] || "";
      const text = (code ?? element).textContent?.replace(/\n$/, "") || "";
      if(element.closest("td,th")) return text.split("\n").map(line=>{
        if(!line) return "";
        if(oddPipeBackslashes(line)) return tableCodeText(line);
        const fence="`".repeat(Math.max(1,...[...line.matchAll(/`+/g)].map(match=>match[0].length+1)));
        const pad=/^`|`$|^ .*?[^ ].* $/.test(line) ? " " : "";
        return `${fence}${pad}${line}${pad}${fence}`;
      }).join("\n");
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });
  return turndown.turndown(copy as HTMLElement).trim();
};

export const isPlatformClip = (value: unknown, expected: PlatformTarget): value is PlatformClip => {
  if (!value || typeof value !== "object") return false;
  const clip = value as Partial<PlatformClip>;
  const time = clip.publishedAt;
  return clip.platform === expected.platform && clip.id === expected.id && clip.url === expected.url
    && typeof clip.title === "string" && !!clip.title.trim() && clip.title.length <= 10_000
    && typeof clip.markdown === "string" && !!clip.markdown.trim() && clip.markdown.length <= 2_000_000
    && (clip.author === undefined || typeof clip.author === "string")
    && (clip.authorHeadline === undefined || typeof clip.authorHeadline === "string")
    && (!time || (typeof time.value === "string" && ["datetime", "date", "relative"].includes(time.precision)))
    && Array.isArray(clip.tags) && clip.tags[0] === "web-clip" && clip.tags[1] === expected.platform
    && (expected.platform === "xueqiu"
      ? clip.tags.length >= 3 && clip.tags.length <= 24 && clip.tags[2] === "投资"
        && clip.tags.slice(3).every((tag) => typeof tag === "string" && /^(?:[A-Z][A-Z0-9.-]*|\d{5})$/.test(tag))
        && new Set(clip.tags).size === clip.tags.length
      : clip.tags.length === 2)
    && (clip.completeness === "complete" || (clip.platform === "xiaoyuzhou" && clip.completeness === "no-shownotes"));
};
