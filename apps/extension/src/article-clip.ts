import { markdownText, markdownUrl, platformElementHidden, platformHtmlMarkdown, platformReadableCopy, platformTarget, platformText, publishedTime, safePlatformUrl, type PlatformRead, type PlatformTarget, type PublishedTime } from "./platform-clip";
import { restoreWechatHeadings } from "./wechat-headings";

const readableText = (node: Element | null) => node ? platformText(platformReadableCopy(node)) : "";

/** Sspai keeps article updates beside the main body, apart from its update
 * navigation and author/interaction cards. Keep each update as a quoted note. */
const sspaiUpdateMarkdown = (body: Element, pageUrl: string): string[] => {
  const parts: string[]=[];
  for(const wrapper of Array.from(body.parentElement?.children || [])) {
    if(!wrapper.matches(".update__details__wrapper")) continue;
    for(const item of Array.from(wrapper.children)) {
      if(!item.matches(".update-details-item")) continue;
      const copy=platformReadableCopy(item), content=copy.querySelector(".update-body");
      const markdown=content ? platformHtmlMarkdown(content,pageUrl) : "";
      if(!markdown) continue;
      const title=platformText(copy.querySelector(".update-title"));
      const date=platformText(copy.querySelector(".update-date"));
      const update=[date ? markdownText(date) : "",title ? `**${markdownText(title)}**` : "",markdown].filter(Boolean).join("\n\n");
      parts.push(update.split("\n").map(line=>line ? `> ${line}` : ">").join("\n"));
    }
  }
  return parts;
};

/** Remove publisher chrome inside #js_content, on the detached copy only. */
const cleanWechatContent = (body: Element, pageUrl: string) => {
  body.querySelectorAll("mp-common-cpsad").forEach(node=>node.remove());
  // WeChat's code widget uses one sibling <code> per line, whereas the shared
  // Markdown converter expects a single code element inside each <pre>.
  for(const pre of Array.from(body.querySelectorAll("pre.code-snippet__js"))) {
    const lines=Array.from(pre.children);
    if(lines.length < 2 || lines.some(line=>line.tagName !== "CODE") || Array.from(pre.childNodes).some(node=>node.nodeType === 3 && node.textContent?.trim())) continue;
    const code=lines[0].cloneNode(false);
    code.textContent=lines.map(line=>line.textContent || "").join("\n");
    pre.textContent="";pre.appendChild(code);
  }
  const followPrompt = (node: Element) => !node.closest("pre,code,blockquote") && !node.querySelector("pre,code,blockquote")
    && /^(?:请)?(?:点击|轻点)(?:上方|下方)?的?(?:蓝字|蓝色文字)(?:(?:关注|关于|订阅)(?:我们|公众号|本公众号|本号))?$/.test(platformText(node).replace(/[\s，,:：。！!~～]+/g,""));
  for(const node of Array.from(body.querySelectorAll("p,section,div"))) {
    if(!followPrompt(node)) continue;
    let banner=node;
    // Include the banner's decorative arrow, but stop before article prose.
    while(banner.parentElement && banner.parentElement !== body && followPrompt(banner.parentElement)) banner=banner.parentElement;
    banner.remove();
  }
  for(const image of Array.from(body.querySelectorAll("img.__bg_gif[alt]"))) {
    if(!image.closest("pre,code,blockquote") && /^(?:分割线|分隔线|divider|separator)$/i.test(image.getAttribute("alt")?.trim() || "")) image.remove();
  }
  // Only trailing standalone native article cards are recommendations. Keep
  // inline citations, linked illustrations and cards followed by more prose.
  for(const block of Array.from(body.children).reverse()) {
    if(!platformText(block) && !block.querySelector("img,pre,table")) continue;
    const links=Array.from(block.querySelectorAll("a[href]"));
    const link=block.matches("a[href]") ? block : links.length === 1 ? links[0] : null;
    const href=link && safePlatformUrl(link.getAttribute("href") || "",pageUrl);
    if(!link || !href || !link.querySelector(".h5_image_link") || platformText(link) !== platformText(block)) break;
    const url=new URL(href);
    if(url.hostname !== "mp.weixin.qq.com" || !/^\/s(?:\/|$)/.test(url.pathname)) break;
    link.remove();
  }
  restoreWechatHeadings(body);
};

/** Preserve source date precision and clock values; do not infer a timezone. */
export const articlePublishedTime = (node: Element | null): PublishedTime | undefined => {
  if (!node) return;
  const visible=node.tagName === "META" || !platformElementHidden(node), clean=platformReadableCopy(node);
  if (!visible) for(const attr of ["datetime","title","content"]) clean.removeAttribute(attr);
  const value = (visible ? node.getAttribute("datetime") || (node.tagName === "META" ? node.getAttribute("content") : "") : "") || platformText(clean) || (visible ? node.getAttribute("content") : "") || "";
  if (!value) return;
  const chinese = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  const date = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?))?$/.exec(value.trim());
  if (chinese) {
    const day = `${chinese[1]}-${chinese[2].padStart(2,"0")}-${chinese[3].padStart(2,"0")}`;
    return chinese[4] ? { value:`${day}T${chinese[4].padStart(2,"0")}:${chinese[5]}:${chinese[6] || "00"}`,precision:"datetime" } : {value:day,precision:"date"};
  }
  if (date) return date[2] ? {value:`${date[1]}T${date[2]}`,precision:"datetime"} : {value:date[1],precision:"date"};
  return publishedTime(clean);
};

const articleIdentityMatches = (expected: PlatformTarget, candidate: PlatformTarget | null): boolean => {
  if (!candidate || candidate.platform !== expected.platform) return false;
  // WeChat short and query identities cannot be compared solely by spelling.
  return candidate.id === expected.id || (expected.platform === "wechat" && candidate.id.includes("/") !== expected.id.includes("/"));
};

export const readArticle = (doc: Document, pageUrl: string, accountLabel: string, wechatPictureState?: unknown): PlatformRead => {
  const target = platformTarget(pageUrl);
  if (!target || !["wechat","sspai","juejin"].includes(target.platform)) return {ok:false,reason:"not-target"};
  const declared = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
  const declaredTarget = declared ? platformTarget(safePlatformUrl(declared, target.url)) : null;
  if (declared && !articleIdentityMatches(target,declaredTarget)) return {ok:false,reason:"changed"};
  let titleNode: Element | null, body: Element | null, authorNode: Element | null, timeNode: Element | null;
  let pictureContent: Element | null = null;
  let account = "";
  if (target.platform === "wechat") {
    pictureContent=doc.querySelector("#js_content #js_image_content");
    if (pictureContent) {
      // Hydration hides #img_list and mounts a live carousel beside it.
      const gallery=Array.from(doc.querySelectorAll("#js_article .img_swiper_area .share_media")).find(node=>!platformElementHidden(node));
      if (platformElementHidden(pictureContent) || !gallery) return {ok:false,reason:"unreadable"};
      titleNode=pictureContent.querySelector(".rich_media_title");
      body=pictureContent.querySelector("#js_image_desc") || doc.createElement("div");
    } else {
      titleNode=doc.querySelector("#activity-name"); body=doc.querySelector("#js_content");
    }
    authorNode=doc.querySelector("#js_author_name"); timeNode=doc.querySelector("#publish_time");
    account=readableText(doc.querySelector(pictureContent ? "#js_wx_follow_nickname .nickNameSpan" : "#js_name"));
  } else if (target.platform === "sspai") {
    const article=doc.querySelector("article.normal-article");
    titleNode=article?.querySelector("#article-title") || null;
    body=article?.querySelector(".article__main__content") || null;
    authorNode=article?.querySelector(".article__header__author .ss__user__nickname > span") || null;
    timeNode=article?.querySelector(".article__header__date") || null;
  } else {
    const article=doc.querySelector("article.article");
    const id=article?.getAttribute("data-entry-id");
    if (id && id !== target.id) return {ok:false,reason:"changed"};
    titleNode=article?.querySelector("h1.article-title") || null;
    body=article?.querySelector(".article-viewer.markdown-body") || null;
    authorNode=article?.querySelector(".author-name .name") || null;
    timeNode=article?.querySelector('meta[itemprop="datePublished"],time') || null;
  }
  const title=readableText(titleNode) || (pictureContent
    ? doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || doc.title.trim()
    : "");
  if (!title || !body) return {ok:false,reason:"unreadable"};
  let pictures: string[] | undefined;
  if (pictureContent) {
    const state=wechatPictureState as {pageUrl?: unknown;url?: unknown;pictures?: unknown} | null;
    if (!state || typeof state.pageUrl !== "string" || typeof state.url !== "string" || !Array.isArray(state.pictures)) return {ok:false,reason:"incomplete"};
    if (state.pageUrl !== pageUrl) return {ok:false,reason:"changed"};
    const identity=platformTarget(state.url);
    if (!articleIdentityMatches(target,identity) || (declaredTarget && !articleIdentityMatches(declaredTarget,identity))) return {ok:false,reason:"changed"};
    pictures=state.pictures.map(value=>typeof value === "string" ? safePlatformUrl(value,target.url) : "");
    if (!pictures.length || pictures.some(url=>!url)) return {ok:false,reason:"incomplete"};
  }
  const clean=platformReadableCopy(body);
  if(target.platform === "wechat" && !pictureContent) cleanWechatContent(clean,target.url);
  // These are article controls, not text/code authored into the article.
  Array.from(clean.querySelectorAll('.code-block-extension-header, .code-block-extension-copyCodeBtn')).forEach(n=>n.remove());
  const markdown=platformHtmlMarkdown(clean,target.url);
  if (!markdown && !pictures) return {ok:false,reason:"unreadable"};
  let author=readableText(authorNode);
  if (target.platform === "sspai") author=[...new Set(Array.from(body.closest("article.normal-article")?.querySelectorAll(".article__header__author .ss__user__nickname > span") || []).map(readableText).filter(Boolean))].join(", ");
  // Juejin publishes the author in its article-scoped schema metadata, even
  // when the visual author header is collapsed by the current desktop layout.
  if (!author && target.platform === "juejin") author=doc.querySelector('article.article [itemprop="author"] meta[itemprop="name"]')?.getAttribute("content")?.trim() || "";
  const parts: string[]=[];
  if (account) parts.push(`${markdownText(accountLabel)}: ${markdownText(account)}`);
  if (pictures) parts.push(pictures.map(url=>`![](${markdownUrl(url)})`).join("\n\n"));
  else if (target.platform === "wechat") {
    const cover=safePlatformUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "",target.url);
    if (cover && !Array.from(clean.querySelectorAll("img")).some(img=>["data-src","data-original","src"].some(a=>safePlatformUrl(img.getAttribute(a)||"",target.url)===cover))) parts.push(`![${markdownText(title)}](${markdownUrl(cover)})`);
  }
  if (markdown) parts.push(markdown);
  if(target.platform === "sspai") parts.push(...sspaiUpdateMarkdown(body,target.url));
  return {ok:true,clip:{...target,title,author:author || undefined,publishedAt:articlePublishedTime(timeNode),markdown:parts.join("\n\n"),tags:["web-clip",target.platform],completeness:"complete"}};
};
