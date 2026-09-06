export type MobileSharedPayload = {
  contentMimeType?: string | null;
  contentType?: string | null;
  contentUri?: string | null;
  mimeType?: string;
  originalName?: string | null;
  shareType?: string;
  value?: string;
};

export type MobileSharedImage = {
  mimeType: string;
  name: string;
  uri: string;
};

export type MobileWebClipDraft = {
  contentMarkdown: string;
  sourceUrl: string;
  tagsText: string;
  title: string;
};

export type MobileRenderedWebPage = {
  contentHtml: string;
  finalUrl?: string;
  title?: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'）)]+/i;
const WECHAT_ARTICLE_HOSTS = new Set(["mp.weixin.qq.com"]);
const BLOCK_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "div",
  "figure",
  "figcaption",
  "footer",
  "header",
  "main",
  "p",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
]);

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: "\"",
  rdquo: "”",
  rsquo: "’",
};

export const getSharedWebUrl = (payloads: MobileSharedPayload[]) => {
  for (const payload of payloads) {
    const value = payload.value?.trim() ?? "";
    const match = value.match(URL_PATTERN);
    if (!match) {
      continue;
    }
    try {
      const url = new URL(match[0]);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // Ignore malformed text and continue looking through other payloads.
    }
  }
  return null;
};

export const getSharedImages = (payloads: MobileSharedPayload[]): MobileSharedImage[] =>
  payloads.flatMap((payload, index) => {
    const mimeType = payload.contentMimeType?.trim() || payload.mimeType?.trim() || "";
    const isImage = payload.contentType === "image" || payload.shareType === "image" || mimeType.startsWith("image/");
    const uri = payload.contentUri?.trim() || payload.value?.trim() || "";
    if (!isImage || !uri) {
      return [];
    }

    return [{
      mimeType: mimeType || "image/jpeg",
      name: payload.originalName?.trim() || `shared-image-${index + 1}`,
      uri,
    }];
  });

export const isWeChatArticleUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && WECHAT_ARTICLE_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.startsWith("/s");
  } catch {
    return false;
  }
};

export const buildMobileWebClipDraft = async (
  sourceUrl: string,
  options: {
    fetcher?: typeof fetch;
    capturedAt?: Date;
  } = {}
): Promise<MobileWebClipDraft> => {
  const fetcher = options.fetcher ?? fetch;
  const capturedAt = options.capturedAt ?? new Date();
  let html = "";
  let finalUrl = sourceUrl;

  try {
    const response = await fetcher(sourceUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    finalUrl = response.url || sourceUrl;
    html = await response.text();
  } catch {
    return buildFallbackDraft(sourceUrl, capturedAt);
  }

  const title = extractPageTitle(html) || hostnameTitle(sourceUrl);
  const articleHtml = isWeChatArticleUrl(sourceUrl)
    ? extractElementInnerHtmlById(html, "js_content")
    : extractFirstElementInnerHtml(html, ["article", "main"]);
  return buildMobileWebClipDraftFromRenderedPage(
    sourceUrl,
    {
      contentHtml: articleHtml,
      finalUrl,
      title,
    },
    { capturedAt },
  );
};

export const buildMobileWebClipDraftFromRenderedPage = (
  sourceUrl: string,
  page: MobileRenderedWebPage,
  options: {
    capturedAt?: Date;
  } = {},
): MobileWebClipDraft => {
  const capturedAt = options.capturedAt ?? new Date();
  const title = normalizeInlineText(page.title ?? "") || hostnameTitle(sourceUrl);
  const body = htmlToMarkdown(page.contentHtml, page.finalUrl || sourceUrl);

  if (!body) {
    return { ...buildFallbackDraft(sourceUrl, capturedAt), title };
  }

  return {
    title,
    sourceUrl,
    tagsText: isWeChatArticleUrl(sourceUrl) ? "web-clip, wechat" : "web-clip",
    contentMarkdown: [
      `来源：[${escapeMarkdownText(sourceUrl)}](${sourceUrl})`,
      `剪藏时间：${capturedAt.toISOString()}`,
      "---",
      body,
    ].join("\n\n"),
  };
};

export const extractPageTitle = (html: string) => {
  for (const property of ["og:title", "twitter:title"]) {
    const meta = findMetaContent(html, property);
    if (meta) {
      return normalizeInlineText(meta);
    }
  }

  const activityTitle = extractElementInnerHtmlById(html, "activity-name");
  if (activityTitle) {
    return normalizeInlineText(stripTags(activityTitle));
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return titleMatch ? normalizeInlineText(stripTags(titleMatch[1])) : "";
};

export const htmlToMarkdown = (html: string, baseUrl?: string) => {
  if (!html.trim()) {
    return "";
  }

  let value = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|iframe|svg|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  value = value.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = readAttribute(tag, "data-src") || readAttribute(tag, "data-original") || readAttribute(tag, "src");
    if (!src || src.startsWith("data:")) {
      return "";
    }
    const resolvedSrc = resolveWebUrl(src, baseUrl);
    if (!resolvedSrc) {
      return "";
    }
    const alt = normalizeInlineText(readAttribute(tag, "alt") || "图片");
    return `\n\n![${escapeMarkdownText(alt)}](${resolvedSrc})\n\n`;
  });

  value = value.replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, (full, inner: string) => {
    const href = readAttribute(full, "href");
    const label = normalizeInlineText(stripTags(inner));
    if (!href || /^javascript:/i.test(href)) {
      return label;
    }
    const resolvedHref = resolveWebUrl(href, baseUrl);
    return resolvedHref
      ? `[${escapeMarkdownText(label || resolvedHref)}](${resolvedHref})`
      : label;
  });

  value = value
    .replace(/<h([1-6])\b[^>]*>/gi, (_tag, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/(strong|b)\s*>/gi, "**")
    .replace(/<(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/(em|i)\s*>/gi, "*")
    .replace(/<code\b[^>]*>/gi, "`")
    .replace(/<\/code\s*>/gi, "`")
    .replace(/<\/?blockquote\b[^>]*>/gi, "\n\n> ")
    .replace(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi, (tag, name: string) =>
      BLOCK_TAGS.has(name.toLowerCase()) ? "\n\n" : tag.startsWith("</") ? "" : ""
    );

  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const buildFallbackDraft = (sourceUrl: string, capturedAt: Date): MobileWebClipDraft => ({
  title: hostnameTitle(sourceUrl),
  sourceUrl,
  tagsText: isWeChatArticleUrl(sourceUrl) ? "web-clip, wechat" : "web-clip",
  contentMarkdown: [
    `来源：[${escapeMarkdownText(sourceUrl)}](${sourceUrl})`,
    `剪藏时间：${capturedAt.toISOString()}`,
    "",
    "正文暂时无法抓取，来源链接已保留，可稍后重试。",
  ].join("\n\n"),
});

const hostnameTitle = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return "网页剪藏";
  }
};

const findMetaContent = (html: string, property: string) => {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = readAttribute(tag, "property") || readAttribute(tag, "name");
    if (key.toLowerCase() === property.toLowerCase()) {
      return decodeHtmlEntities(readAttribute(tag, "content"));
    }
  }
  return "";
};

const extractFirstElementInnerHtml = (html: string, tags: string[]) => {
  for (const tag of tags) {
    const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
};

const extractElementInnerHtmlById = (html: string, id: string) => {
  const openingTagPattern = /<([a-z][a-z0-9-]*)\b[^>]*>/gi;
  let openingMatch: RegExpExecArray | null;
  while ((openingMatch = openingTagPattern.exec(html))) {
    if (readAttribute(openingMatch[0], "id") !== id) {
      continue;
    }
    const tagName = openingMatch[1].toLowerCase();
    const contentStart = openingTagPattern.lastIndex;
    const boundaryPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
    boundaryPattern.lastIndex = contentStart;
    let depth = 1;
    let boundaryMatch: RegExpExecArray | null;
    while ((boundaryMatch = boundaryPattern.exec(html))) {
      if (boundaryMatch[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          return html.slice(contentStart, boundaryMatch.index);
        }
      } else if (!boundaryMatch[0].endsWith("/>")) {
        depth += 1;
      }
    }
    return html.slice(contentStart);
  }
  return "";
};

const readAttribute = (tag: string, name: string) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
};

const stripTags = (value: string) => value.replace(/<[^>]*>/g, " ");
const normalizeInlineText = (value: string) => decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
const escapeMarkdownText = (value: string) => value.replace(/([\\[\]])/g, "\\$1");
const resolveWebUrl = (value: string, baseUrl?: string) => {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return /^https?:\/\//i.test(value) ? value : url.toString();
  } catch {
    return "";
  }
};

const decodeHtmlEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);?/gi, (entity, key: string) => {
    if (key.startsWith("#x") || key.startsWith("#X")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return HTML_ENTITIES[key.toLowerCase()] ?? entity;
  });
