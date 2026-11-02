import { articlePlatform, substackPaywall } from "./article-platform";
import { configurePlatformImageRequests, isPlatformImageUrl } from "./platform-image-requests";
import {
  clipNotebookId,
  edgeEverFormRequest,
  edgeEverRequest,
  getInstancePermissionPattern,
  getSettings,
  listNotebooks,
  uploadMemoImage,
  type ExtensionSettings,
} from "./extension";
import {
  filenameForImage,
  imageFromBase64,
  imageFromBytes,
  imageFromDataUrl,
  imageHostName,
  imageOriginPattern,
  isPageImageRead,
  MAX_IMAGE_BYTES,
  noteTitleForImage,
  preferredImageUrls,
  saveCapturedImageNote,
  type ImageNoteClient,
  type PageImageRead,
  type StoredImage,
  type StoredImageFailure,
} from "./image-clip";
import {
  embedPageImages,
  pageImageRefs,
  readBodyWithLimit,
  readPageImageInPage,
  type PageImageDownload,
} from "./page-images";
import {
  githubRepoFactsFromSource,
  githubRepoNoteMarkdown,
  githubRepoNoteTitle,
  githubRepoTarget,
  type GithubRepoFacts,
  type GithubRepoPageSource,
} from "./github-repo";
import {
  selectionNoteMarkdown,
  selectionTextMarkdown,
  selectionNoteTitle,
} from "./selection-clip";
import {
  redditPostFromApi,
  redditPostFromDom,
  saveCapturedRedditPost,
} from "./reddit-clip";
import {
  canonicalStatusUrl,
  isCapturedTweet,
  saveCapturedTweetNote,
  statusIdFromPageUrl,
  tweetNoteTitle,
} from "./tweet-clip";
import {
  isXhsPageRead,
  noteIdFromPageUrl,
  readXhsStateInPage,
  resolveXhsNote,
  saveCapturedXhsNote,
  xhsNoteTitle,
} from "./xhs-clip";
import {
  fetchZhihuItemInPage,
  isZhihuApiRead,
  isZhihuLocate,
  resolveZhihuNote,
  saveCapturedZhihuNote,
  zhihuBodyFromHtml,
  zhihuNoteTitle,
  zhihuTargetFromPageUrl,
  zhihuTimeIso,
  type ZhihuLocateSuccess,
} from "./zhihu-clip";
import { bilibiliCaptureFromRead, bilibiliTargetFromUrl } from "./video/bilibili";
import { VIDEO_DOCUMENT_PATTERNS } from "./video/patterns";
import { isBilibiliPageRead, readBilibiliVideoInPage } from "./video/read-bilibili-in-page";
import { isYouTubePageRead, readYouTubeVideoInPage } from "./video/read-youtube-in-page";
import {
  persistVideoNote,
  postVideoOutline,
  videoOutlineRequestBody,
  type VideoNoteLabels,
} from "./video/video-note";
import type { OutlineAttempt, VideoNoteToast } from "./video/types";
import { youtubeCaptureFromRead, youtubeTargetFromUrl } from "./video/youtube";
import { t } from "./i18n";
import { readXiaoyuzhouStateInPage } from "./xiaoyuzhou-clip";
import { jikeLoginPost } from "./jike-clip";
import { readJikeWebStateInPage } from "./jike-web-state";
import { readWechatPictureStateInPage } from "./wechat-picture-state";
import { bossLoginRequired } from "./boss-clip";
import {
  isPlatformClip,
  markdownText,
  markdownUrl,
  PLATFORM_MENUS,
  platformTarget,
  socialPlatform,
  publishedTimeText,
  clipDateTimeText,
  type PlatformTarget,
  type PublishedTime,
} from "./platform-clip";

type CapturedPage = {
  title: string;
  url: string;
  markdown: string;
  plainText?: string;
  kind?: "page" | "selection" | "region";
  platform?: "medium" | "substack";
  author?: string;
  publishedAt?: PublishedTime;
};

type PendingImageSave = {
  urls: string[];
  srcUrl: string;
  pageUrl: string;
  pageTitle: string;
  tabId: number | null;
  frameId: number | null;
  originPattern: string;
  host: string;
};

const IMAGE_MENU_ID = "save-image";
const SELECTION_MENU_ID = "save-selection";
const TWEET_MENU_ID = "save-tweet";
const GITHUB_REPO_MENU_ID = "save-github-repo";
const PENDING_IMAGE_SAVE_KEY = "pendingImageSave";
const IMAGE_SAVE_WINDOW_KEY = "imageSaveWindowId";
const PENDING_TWEET_KEY = "pendingTweetPermission";
const TWEET_WINDOW_KEY = "tweetSaveWindowId";
const TWEET_DOCUMENT_PATTERNS = [
  "https://x.com/*",
  "https://www.x.com/*",
  "https://twitter.com/*",
  "https://www.twitter.com/*",
  "https://mobile.twitter.com/*",
];
const GITHUB_DOCUMENT_PATTERNS = [
  "https://github.com/*",
  "https://www.github.com/*",
];
const XHS_MENU_ID = "save-xhs";
const PENDING_XHS_KEY = "pendingXhsPermission";
const XHS_WINDOW_KEY = "xhsSaveWindowId";
const XHS_DOCUMENT_PATTERNS = [
  "https://www.xiaohongshu.com/*",
  "https://xiaohongshu.com/*",
];
const ZHIHU_MENU_ID = "save-zhihu";
const PENDING_ZHIHU_KEY = "pendingZhihuPermission";
const ZHIHU_WINDOW_KEY = "zhihuSaveWindowId";
const ZHIHU_DOCUMENT_PATTERNS = [
  "https://www.zhihu.com/*",
  "https://zhihu.com/*",
  "https://zhuanlan.zhihu.com/*",
  "https://www.zhuanlan.zhihu.com/*",
];
const VIDEO_MENU_ID = "save-video";
const REDDIT_MENU_ID = "save-reddit";
const REDDIT_LINK_MENU_ID = "save-reddit-link";
const REDDIT_DOCUMENT_PATTERNS = [
  "https://reddit.com/*",
  "https://www.reddit.com/*",
  "https://old.reddit.com/*",
  "https://new.reddit.com/*",
  "https://sh.reddit.com/*",
];

const toMarkdown = (page: CapturedPage) => {
  const capturedAt = clipDateTimeText(new Date().toISOString());
  const metadata=page.platform ? [
    page.author ? `${t("platformAuthorLabel")}: ${markdownText(page.author)}` : "",
    page.publishedAt ? `${t("platformPublishedAtLabel")}: ${markdownText(publishedTimeText(page.publishedAt,t("platformRelativeTimeLabel")))}` : "",
  ].filter(Boolean).map(value=>`${value}\n\n`).join("") : "";
  return `# ${markdownText(page.title)}\n\n${t("sourceLabel")}: [${markdownText(page.url)}](${markdownUrl(page.url)})\n\n${metadata}${t("capturedAtLabel")}: ${capturedAt}\n\n---\n\n${page.markdown}`;
};

const compactError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
};

const describeCaptureError = (error: unknown) => {
  const message = compactError(error);
  if (message === t("captureTimeout")) {
    return message;
  }
  if (/cannot access (contents|a page)|missing host permission|extensions gallery|chrome:\/\/|edge:\/\/|about:\/\//i.test(message)) {
    return t("pageAccessDenied");
  }
  return t("captureScriptFailed", message || t("captureUnknownError"));
};

const describeSaveError = (error: unknown) => {
  const message = compactError(error);
  if (/write:resources/i.test(message)) {
    return t("imageResourceScopeRequired");
  }
  if (/failed to fetch|networkerror|load failed|network request/i.test(message)) {
    return t("instanceNetworkFailed");
  }
  return t("saveFailedWithReason", message || t("saveFailed"));
};

const notebookForClip = async (settings: ExtensionSettings) => {
  const notebooks = await listNotebooks(settings);
  const notebookId = clipNotebookId(settings.notebookId, notebooks.notebooks);
  if (!notebookId) throw new Error(t("noAvailableNotebooks"));
  return notebookId;
};

const clipImageFeedback = (images: { embedded: number; total: number }) =>
  images.embedded < images.total ? t("platformImagesPartial")
    : images.total > 0 ? t("platformSavedWithImages") : t("savedToEdgeEver");

const createMemo = async (settings: ExtensionSettings, page: CapturedPage, tabId: number | null, expectedUrl?: string) => {
  const contentMarkdown = toMarkdown(page);
  const notebookId = await notebookForClip(settings);
  if (expectedUrl && (tabId === null || (await chrome.tabs.get(tabId)).url !== expectedUrl)) {
    throw new Error(t("platformPageChanged"));
  }
  const created = await edgeEverRequest<{ memo?: CreatedClipMemo }>(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify({
      notebookId,
      title: page.title,
      contentMarkdown,
      tags: page.platform ? ["web-clip",page.platform] : ["web-clip"],
    }),
  });
  return embedClipImages(settings, created.memo, contentMarkdown, page.url, tabId, null);
};

const createGithubRepoMemo = async (settings: ExtensionSettings, facts: GithubRepoFacts) => {
  await edgeEverRequest(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify({
      notebookId: await notebookForClip(settings),
      title: githubRepoNoteTitle(facts.owner, facts.name),
      contentMarkdown: githubRepoNoteMarkdown({
        canonicalUrl: facts.canonicalUrl,
        intro: facts.intro,
        homepage: facts.homepage,
        language: facts.language,
        license: facts.license,
        topics: facts.topics,
        capturedAt: clipDateTimeText(new Date().toISOString()),
        sourceLabel: t("sourceLabel"),
        capturedAtLabel: t("capturedAtLabel"),
        homepageLabel: t("githubRepoHomepageLabel"),
        languageLabel: t("githubRepoLanguageLabel"),
        licenseLabel: t("githubRepoLicenseLabel"),
        topicsLabel: t("githubRepoTopicsLabel"),
      }),
      tags: ["web-clip"],
    }),
  });
};

const imageNoteClient = (settings: ExtensionSettings): ImageNoteClient => ({
  listNotebooks: () => listNotebooks(settings),
  createMemo: (body) => edgeEverRequest(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  uploadImage: async (memoId, file, signal) => {
    const uploaded = await uploadMemoImage(settings, memoId, file, signal);
    return uploaded.resource;
  },
  createEditSession: (memoId) => edgeEverRequest(
    settings,
    `/api/v1/memos/${encodeURIComponent(memoId)}/edit-sessions`,
    { method: "POST" },
  ),
  saveMemo: (memoId, body) => edgeEverRequest(
    settings,
    `/api/v1/memos/${encodeURIComponent(memoId)}/save`,
    { method: "POST", body: JSON.stringify(body) },
  ),
  deleteMemo: (memoId) => edgeEverRequest(
    settings,
    `/api/v1/memos/${encodeURIComponent(memoId)}?permanent=1`,
    { method: "DELETE" },
  ),
  createWithImage: async (body) => {
    const buffer = new ArrayBuffer(body.bytes.byteLength);
    new Uint8Array(buffer).set(body.bytes);
    const form = new FormData();
    form.append("notebookId", body.notebookId);
    form.append("title", body.title);
    form.append("contentMarkdown", body.contentMarkdown);
    form.append("tags", JSON.stringify(body.tags));
    form.append("file", new File([buffer], body.filename, { type: body.mimeType }));
    const created = await edgeEverFormRequest<{ memo: { id: string }; resourceId: string }>(
      settings,
      "/api/v1/memos/with-image",
      form,
    );
    if (!created.memo?.id || !created.resourceId) throw new Error("create-missing-id");
    return { memoId: created.memo.id, resourceId: created.resourceId };
  },
});

const scriptTarget = (tabId: number, frameId: number | null) =>
  typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId };

const injectImageHelper = async (tabId: number, frameId: number | null, payload: { action: string; [key: string]: unknown }) => {
  const target = scriptTarget(tabId, frameId);
  await chrome.scripting.executeScript({
    target,
    func: (value: unknown) => {
      (globalThis as { __edgeeverImageClipPayload?: unknown }).__edgeeverImageClipPayload = value;
    },
    args: [payload],
  });
  await chrome.scripting.executeScript({
    target,
    files: [payload.action === "toast" ? "assets/clip-feedback.js" : "assets/capture-image.js"],
  });
};

const showFeedback = async (
  tabId: number | null,
  frameId: number | null,
  message: string,
  kind: "normal" | "success" | "error",
) => {
  if (tabId) {
    try {
      await injectImageHelper(tabId, frameId, { action: "toast", message, kind, closeLabel: t("closeNotification"), regionLabel: t("clipNotifications") });
      return;
    } catch {
      // Restricted pages cannot host the toast. The toolbar badge still reports the result.
    }
  }
  await chrome.action.setBadgeBackgroundColor({ color: kind === "error" ? "#b91c1c" : "#171717" });
  await chrome.action.setBadgeText({ text: kind === "error" ? "!" : "✓" });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, 4000);
};

const imageFailureMessage = (reason: StoredImageFailure["error"]) => {
  if (reason === "too-large") return t("imageTooLarge");
  if (reason === "unsupported") return t("imageUnsupportedType");
  return t("imageUnreadable");
};

const describeImageError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (
    message === t("instancePermissionRequired")
    || message === t("completePluginConfiguration")
    || message === t("noAvailableNotebooks")
    || message === t("imageTooLarge")
    || message === t("imageUnsupportedType")
    || message === t("imageUnreadable")
  ) {
    return message;
  }
  return describeSaveError(error);
};

const ensureClipperReady = async () => {
  const settings = await getSettings();
  if (!settings.instanceUrl || !settings.token) {
    throw new Error(t("completePluginConfiguration"));
  }
  const granted = await chrome.permissions.contains({ origins: [getInstancePermissionPattern(settings.instanceUrl)] });
  if (!granted) throw new Error(t("instancePermissionRequired"));
  return settings;
};

const persistImage = async (
  settings: ExtensionSettings,
  image: StoredImage,
  context: { srcUrl: string; pageUrl: string; pageTitle: string; alt: string },
) => {
  try {
    await saveCapturedImageNote(imageNoteClient(settings), {
      notebookId: await notebookForClip(settings),
      title: noteTitleForImage(context.pageTitle, context.alt, t("imageNoteFallbackTitle")),
      alt: context.alt,
      filename: filenameForImage(context.srcUrl, image.mimeType),
      mimeType: image.mimeType,
      bytes: image.bytes,
      pageUrl: context.pageUrl,
      capturedAt: clipDateTimeText(new Date().toISOString()),
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
      googleSearchLabel: t("googleSearchLabel"),
      keywordLabel: t("searchKeywordLabel"),
      altFallback: t("imageAltFallback"),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "no-notebook") {
      throw new Error(t("noAvailableNotebooks"));
    }
    throw error;
  }
};

const requestSignal = (timeoutMs: number, signal?: AbortSignal) => {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return controller.signal;
};

let platformImageRulesReady: Promise<void> | undefined;
const downloadImage = async (
  urls: string[],
  { maxBytes = MAX_IMAGE_BYTES, timeoutMs = 15000, signal }: { maxBytes?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<StoredImage | StoredImageFailure> => {
  const matchUrl = urls[urls.length - 1] ?? "";
  let matchError: StoredImageFailure["error"] | "" = "";
  for (const url of urls) {
    if (!/^https?:/i.test(url)) continue;
    if (isPlatformImageUrl(url)) {
      platformImageRulesReady ??= configurePlatformImageRequests().catch(() => undefined);
      await platformImageRulesReady;
    }
    for (const credentials of ["omit", "include"] as const) {
      if (signal?.aborted) return { error: "unreadable" };
      try {
        const response = await fetch(url, { credentials, signal: requestSignal(timeoutMs, signal) });
        if (!response.ok) continue;
        const bytes = await readBodyWithLimit(response, maxBytes);
        if (!bytes) {
          if (url === matchUrl) matchError = "too-large";
          continue;
        }
        const image = imageFromBytes(bytes, response.headers.get("content-type") ?? "");
        if (!("error" in image)) return image;
        if (url === matchUrl) matchError = image.error;
      } catch {
        if (url === matchUrl) matchError = matchError || "unreadable";
      }
    }
  }
  if (matchError === "too-large" || matchError === "unsupported") return { error: matchError };
  return { error: "unreadable" };
};

type CreatedClipMemo = { id?: string; revision?: number; contentHash?: string };

const downloadPageImage = (tabId: number | null, frameId: number | null): PageImageDownload =>
  async (image, { maxBytes, timeoutMs, signal }) => {
    const file = await downloadImage([image.url], { maxBytes, timeoutMs, signal });
    if (!("error" in file)) return file;
    if (tabId === null || signal.aborted) return null;
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: scriptTarget(tabId, frameId),
        func: readPageImageInPage,
        args: [image.url, maxBytes, timeoutMs],
      });
      const read: unknown = injection?.result;
      if (!read || typeof read !== "object") return null;
      const { base64, type } = read as { base64?: unknown; type?: unknown };
      if (typeof base64 !== "string") return null;
      const fromPage = imageFromBase64(base64, typeof type === "string" ? type : "");
      return "error" in fromPage ? null : fromPage;
    } catch {
      // The page cannot be scripted; this image keeps its remote address.
      return null;
    }
  };

const embedClipImages = async (
  settings: ExtensionSettings,
  memo: CreatedClipMemo | undefined,
  markdown: string,
  pageUrl: string,
  tabId: number | null,
  frameId: number | null,
) => {
  // Count all remote images, including those beyond the transfer cap. The new
  // platform path uses this result to report partial archival honestly.
  const images = pageImageRefs(markdown, pageUrl, Number.POSITIVE_INFINITY);
  const unchanged = { embedded: 0, total: images.length };
  if (!memo?.id || typeof memo.revision !== "number" || typeof memo.contentHash !== "string" || images.length === 0) return unchanged;
  try {
    return await embedPageImages(imageNoteClient(settings), {
      memoId: memo.id,
      markdown,
      created: { revision: memo.revision, contentHash: memo.contentHash },
      images,
      download: downloadPageImage(tabId, frameId),
    });
  } catch {
    // The note is already saved; reporting a failure here would invite a
    // duplicate save. Its images keep their remote addresses.
    return unchanged;
  }
};

const hasImagePermission = async (urls: string[]) => {
  const patterns = [...new Set(urls.map(imageOriginPattern).filter((pattern): pattern is string => Boolean(pattern)))];
  for (const pattern of patterns) {
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  }
  return false;
};

const isPendingImageSave = (value: unknown): value is PendingImageSave => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingImageSave>;
  return Array.isArray(record.urls)
    && record.urls.every((url) => typeof url === "string")
    && typeof record.srcUrl === "string"
    && typeof record.pageUrl === "string"
    && typeof record.pageTitle === "string"
    && typeof record.originPattern === "string"
    && typeof record.host === "string";
};

const readPendingImageSave = async () => {
  const stored = await chrome.storage.session.get(PENDING_IMAGE_SAVE_KEY);
  return isPendingImageSave(stored[PENDING_IMAGE_SAVE_KEY]) ? stored[PENDING_IMAGE_SAVE_KEY] : null;
};

const focusExtensionWindow = async (path: string, windowKey: string, height: number) => {
  const stored = await chrome.storage.session.get(windowKey);
  const existingId = stored[windowKey];
  const url = chrome.runtime.getURL(path);
  if (typeof existingId === "number") {
    try {
      const existing = await chrome.windows.get(existingId, { populate: true });
      const existingTabId = existing.tabs?.[0]?.id;
      if (existingTabId) {
        await chrome.tabs.update(existingTabId, { url });
        await chrome.windows.update(existingId, { focused: true });
        return;
      }
    } catch {
      // The previous window has already closed.
    }
  }
  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 440,
    height,
    focused: true,
  });
  if (created.id) await chrome.storage.session.set({ [windowKey]: created.id });
};

const openImagePermissionWindow = async (pending: PendingImageSave) => {
  await chrome.storage.session.set({ [PENDING_IMAGE_SAVE_KEY]: pending });
  await focusExtensionWindow("image-save.html", IMAGE_SAVE_WINDOW_KEY, 640);
};

const openTweetPermissionWindow = async (tabId: number | null) => {
  await chrome.storage.session.set({ [PENDING_TWEET_KEY]: { tabId } });
  await focusExtensionWindow("tweet-save.html", TWEET_WINDOW_KEY, 560);
};

const openXhsPermissionWindow = async (tabId: number | null) => {
  await chrome.storage.session.set({ [PENDING_XHS_KEY]: { tabId } });
  await focusExtensionWindow("xhs-save.html", XHS_WINDOW_KEY, 560);
};

const openZhihuPermissionWindow = async (tabId: number | null) => {
  await chrome.storage.session.set({ [PENDING_ZHIHU_KEY]: { tabId } });
  await focusExtensionWindow("zhihu-save.html", ZHIHU_WINDOW_KEY, 560);
};

let pendingCapture: { requestId: string; resolve: (page: unknown) => void } | null = null;
const pendingImageReads = new Map<string, (result: unknown) => void>();
const pendingTweetReads = new Map<string, (result: unknown) => void>();
const pendingGithubReads = new Map<string, (result: unknown) => void>();
const pendingPlatformReads = new Map<string, {
  tabId: number;
  resolve: (result: unknown) => void;
}>();
const pendingXhsReads = new Map<string, (result: unknown) => void>();
const pendingZhihuReads = new Map<string, (result: unknown) => void>();
const pendingRedditReads = new Map<string, (result: unknown) => void>();
let clipQueue = Promise.resolve();
let completingImageSave = false;

const enqueueClip = <T>(job: () => Promise<T>): Promise<T> => {
  const run = clipQueue.then(job, job);
  clipQueue = run.then(() => undefined, () => undefined);
  return run;
};

const readImageFromPage = async (tabId: number, frameId: number | null, urls: string[], matchUrl: string) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingImageReads.delete(requestId);
      reject(new Error("timeout"));
    }, 20_000);
    pendingImageReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    void injectImageHelper(tabId, frameId, {
      action: "read",
      requestId,
      urls,
      matchUrl,
      maxBytes: MAX_IMAGE_BYTES,
    }).catch((error: unknown) => {
      clearTimeout(timeout);
      pendingImageReads.delete(requestId);
      reject(error);
    });
  });
  return isPageImageRead(result) ? result : { ok: false as const, reason: "unreadable" as const };
};

const reportImageFailure = async (tabId: number | null, frameId: number | null, error: unknown) => {
  const message = describeImageError(error);
  if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
    await chrome.runtime.openOptionsPage();
  }
  await showFeedback(tabId, frameId, message, "error");
};

const saveDownloadedImage = async (
  pending: Pick<PendingImageSave, "urls" | "srcUrl" | "pageUrl" | "pageTitle" | "tabId" | "frameId">,
  alt: string,
) => {
  const settings = await ensureClipperReady();
  const downloaded = await downloadImage(pending.urls);
  if ("error" in downloaded) throw new Error(imageFailureMessage(downloaded.error));
  await persistImage(settings, downloaded, {
    srcUrl: pending.srcUrl,
    pageUrl: pending.pageUrl,
    pageTitle: pending.pageTitle,
    alt,
  });
  await chrome.storage.session.remove(PENDING_IMAGE_SAVE_KEY);
  await showFeedback(pending.tabId, pending.frameId, t("imageSaved"), "success");
};

const saveImageFromMenu = async (
  info: { srcUrl?: string; pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string; title?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const srcUrl = info.srcUrl ?? "";
  const pageUrl = tab?.url || info.pageUrl || "";
  const pageTitle = tab?.title || "";
  try {
    await ensureClipperReady();
    if (!srcUrl) throw new Error(t("imageUnreadable"));
    await showFeedback(tabId, frameId, t("savingImage"), "normal");
    const inlineImage = imageFromDataUrl(srcUrl);
    if (inlineImage && !("error" in inlineImage)) {
      const settings = await ensureClipperReady();
      await persistImage(settings, inlineImage, { srcUrl, pageUrl, pageTitle, alt: "" });
      await chrome.storage.session.remove(PENDING_IMAGE_SAVE_KEY);
      await showFeedback(tabId, frameId, t("imageSaved"), "success");
      return;
    }
    if (inlineImage && "error" in inlineImage) throw new Error(imageFailureMessage(inlineImage.error));
    const urls = preferredImageUrls(srcUrl);
    let pageRead: PageImageRead | null = null;
    if (tabId) {
      try {
        pageRead = await readImageFromPage(tabId, frameId, urls, srcUrl);
      } catch {
        pageRead = null;
      }
    }
    if (pageRead?.ok) {
      const image = imageFromBase64(pageRead.base64, pageRead.mimeType, pageRead.byteSize);
      if ("error" in image) throw new Error(imageFailureMessage(image.error));
      const settings = await ensureClipperReady();
      await persistImage(settings, image, { srcUrl, pageUrl, pageTitle, alt: pageRead.alt });
      await chrome.storage.session.remove(PENDING_IMAGE_SAVE_KEY);
      await showFeedback(tabId, frameId, t("imageSaved"), "success");
      return;
    }
    if (pageRead && !pageRead.ok && (pageRead.reason === "too-large" || pageRead.reason === "unsupported")) {
      throw new Error(imageFailureMessage(pageRead.reason));
    }
    if (await hasImagePermission(urls)) {
      await saveDownloadedImage({ urls, srcUrl, pageUrl, pageTitle, tabId, frameId }, "");
      return;
    }
    const originPattern = imageOriginPattern(srcUrl);
    const host = imageHostName(srcUrl);
    if (!originPattern || !host) throw new Error(t("imageUnreadable"));
    await openImagePermissionWindow({
      urls,
      srcUrl,
      pageUrl,
      pageTitle,
      tabId,
      frameId,
      originPattern,
      host,
    });
    await showFeedback(tabId, frameId, t("imagePermissionToast"), "normal");
  } catch (error) {
    await reportImageFailure(tabId, frameId, error);
  }
};

const injectTweetReader = async (tabId: number, frameId: number | null, payload: unknown) => {
  const target = scriptTarget(tabId, frameId);
  await chrome.scripting.executeScript({
    target,
    func: (value: unknown) => {
      (globalThis as { __edgeeverTweetClipPayload?: unknown }).__edgeeverTweetClipPayload = value;
    },
    args: [payload],
  });
  await chrome.scripting.executeScript({
    target,
    files: ["assets/capture-tweet.js"],
  });
};

const injectTweetTarget = async (tabId: number) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/tweet-target.js"],
  });
};

const readTweetFromPage = async (tabId: number, frameId: number | null, statusId: string) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTweetReads.delete(requestId);
      reject(new Error("timeout"));
    }, 10_000);
    pendingTweetReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    void injectTweetReader(tabId, frameId, { requestId, statusId }).catch((error: unknown) => {
      clearTimeout(timeout);
      pendingTweetReads.delete(requestId);
      reject(error);
    });
  });
  return isCapturedTweet(result) ? result : { ok: false as const, reason: "not-found" as const };
};

const hasTweetSitePermission = async (pageUrl: string) => {
  const pattern = imageOriginPattern(pageUrl);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
};

const readTweetImage = async (tabId: number, frameId: number | null, url: string, alt: string) => {
  const urls = preferredImageUrls(url);
  try {
    const pageRead = await readImageFromPage(tabId, frameId, urls, url);
    if (pageRead.ok) {
      const image = imageFromBase64(pageRead.base64, pageRead.mimeType, pageRead.byteSize);
      if (!("error" in image)) {
        return { ...image, filename: filenameForImage(url, image.mimeType), alt: alt || pageRead.alt };
      }
    }
  } catch {
    // The page could not hand over this photo. Try a permitted download below.
  }
  if (await hasImagePermission(urls)) {
    const downloaded = await downloadImage(urls);
    if (!("error" in downloaded)) {
      return { ...downloaded, filename: filenameForImage(url, downloaded.mimeType), alt };
    }
  }
  return null;
};

const describeTweetError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message === t("tweetNotFound")) return message;
  return describeImageError(error);
};

const saveTweetFromMenu = async (
  info: { pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("tweetNotFound"));
    const statusId = statusIdFromPageUrl(pageUrl);
    if (!statusId && !await hasTweetSitePermission(pageUrl)) {
      await openTweetPermissionWindow(tabId);
      await showFeedback(tabId, frameId, t("tweetPermissionToast"), "normal");
      return;
    }

    await showFeedback(tabId, frameId, t("savingTweet"), "normal");
    const tweet = await readTweetFromPage(tabId, frameId, statusId);
    if (!tweet.ok && tweet.reason === "needs-listener") {
      await injectTweetTarget(tabId);
      await showFeedback(tabId, frameId, t("tweetRightClickAgain"), "normal");
      return;
    }
    if (!tweet.ok) throw new Error(t("tweetNotFound"));

    const images = [];
    for (const image of tweet.images) {
      const stored = await readTweetImage(tabId, frameId, image.url, image.alt);
      if (stored) images.push(stored);
    }
    await saveCapturedTweetNote(imageNoteClient(settings), {
      notebookId: await notebookForClip(settings),
      title: tweetNoteTitle({ ...tweet, fallback: t("tweetNoteFallbackTitle") }),
      displayName: tweet.displayName,
      handle: tweet.handle,
      text: tweet.text,
      quotedDisplayName: tweet.quotedDisplayName,
      quotedHandle: tweet.quotedHandle,
      quotedText: tweet.quotedText,
      datetime: tweet.datetime,
      statusUrl: tweet.statusUrl || canonicalStatusUrl(pageUrl) || pageUrl,
      images,
      capturedAt: clipDateTimeText(new Date().toISOString()),
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
      timeLabel: t("tweetTimeLabel"),
      altFallback: t("imageAltFallback"),
    });
    await showFeedback(tabId, frameId, t("tweetSaved"), "success");
  } catch (error) {
    const message = describeTweetError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const injectXhsReader = async (tabId: number, frameId: number | null, payload: unknown) => {
  const target = scriptTarget(tabId, frameId);
  await chrome.scripting.executeScript({
    target,
    func: (value: unknown) => {
      (globalThis as { __edgeeverXhsClipPayload?: unknown }).__edgeeverXhsClipPayload = value;
    },
    args: [payload],
  });
  await chrome.scripting.executeScript({
    target,
    files: ["assets/capture-xhs.js"],
  });
};

const injectXhsTarget = async (tabId: number) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/xhs-target.js"],
  });
};

const readXhsStateFromPage = async (tabId: number, frameId: number | null) => {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: scriptTarget(tabId, frameId),
      world: "MAIN",
      func: readXhsStateInPage,
    });
    return isXhsPageRead(injected?.result) && injected.result.ok ? injected.result : null;
  } catch {
    // Older pages can block the main world. The DOM reader below still runs.
    return null;
  }
};

const readXhsFromPage = async (tabId: number, frameId: number | null) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingXhsReads.delete(requestId);
      reject(new Error("timeout"));
    }, 10_000);
    pendingXhsReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    void injectXhsReader(tabId, frameId, { requestId }).catch((error: unknown) => {
      clearTimeout(timeout);
      pendingXhsReads.delete(requestId);
      reject(error);
    });
  });
  return isXhsPageRead(result) ? result : { ok: false as const, reason: "not-found" as const };
};

const describeXhsError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message === t("xhsNotFound") || message === t("xhsNeedsOpen")) return message;
  return describeImageError(error);
};

const saveXhsFromMenu = async (
  info: { pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("xhsNotFound"));
    const noteId = noteIdFromPageUrl(pageUrl);
    if (!noteId && !await hasTweetSitePermission(pageUrl)) {
      await openXhsPermissionWindow(tabId);
      await showFeedback(tabId, frameId, t("xhsPermissionToast"), "normal");
      return;
    }

    await showFeedback(tabId, frameId, t("savingXhs"), "normal");
    const page = await readXhsStateFromPage(tabId, frameId) ?? await readXhsFromPage(tabId, frameId);
    if (!page.ok && page.reason === "needs-listener") {
      await injectXhsTarget(tabId);
      await showFeedback(tabId, frameId, t("xhsRightClickAgain"), "normal");
      return;
    }
    if (!page.ok && page.reason === "needs-open") throw new Error(t("xhsNeedsOpen"));
    if (!page.ok) throw new Error(t("xhsNotFound"));
    const note = resolveXhsNote(page, pageUrl);
    if (!note) throw new Error(t("xhsNotFound"));

    const images = [];
    const alt = note.title || t("imageAltFallback");
    for (const url of note.imageUrls) {
      const stored = await readTweetImage(tabId, frameId, url, alt);
      if (stored) images.push(stored);
    }
    await saveCapturedXhsNote(imageNoteClient(settings), {
      notebookId: await notebookForClip(settings),
      title: xhsNoteTitle({ ...note, fallback: t("xhsNoteFallbackTitle") }),
      nickname: note.nickname,
      noteTitle: note.title,
      body: note.body,
      datetime: note.datetime,
      location: note.location,
      noteUrl: note.noteUrl,
      images,
      capturedAt: clipDateTimeText(new Date().toISOString()),
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
      timeLabel: t("tweetTimeLabel"),
      locationLabel: t("xhsLocationLabel"),
      altFallback: t("imageAltFallback"),
    });
    await showFeedback(tabId, frameId, t("xhsSaved"), "success");
  } catch (error) {
    const message = describeXhsError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const injectZhihuReader = async (tabId: number, frameId: number | null, payload: unknown) => {
  const target = scriptTarget(tabId, frameId);
  await chrome.scripting.executeScript({
    target,
    func: (value: unknown) => {
      (globalThis as { __edgeeverZhihuClipPayload?: unknown }).__edgeeverZhihuClipPayload = value;
    },
    args: [payload],
  });
  await chrome.scripting.executeScript({
    target,
    files: ["assets/capture-zhihu.js"],
  });
};

const injectZhihuTarget = async (tabId: number) => {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/zhihu-target.js"],
  });
};

const readZhihuLocate = async (tabId: number, frameId: number | null) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingZhihuReads.delete(requestId);
      reject(new Error("timeout"));
    }, 10_000);
    pendingZhihuReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    void injectZhihuReader(tabId, frameId, { requestId }).catch((error: unknown) => {
      clearTimeout(timeout);
      pendingZhihuReads.delete(requestId);
      reject(error);
    });
  });
  return isZhihuLocate(result) ? result : { ok: false as const, reason: "not-found" as const };
};

const readZhihuApi = async (tabId: number, frameId: number | null, located: ZhihuLocateSuccess) => {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: scriptTarget(tabId, frameId),
      world: "MAIN",
      func: fetchZhihuItemInPage,
      args: [{ kind: located.kind, id: located.id }],
    });
    return isZhihuApiRead(injected?.result) ? injected.result : null;
  } catch {
    return null;
  }
};

const describeZhihuError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message === t("zhihuNotFound") || message === t("zhihuUnreadable")) return message;
  return describeImageError(error);
};

const saveLocatedZhihu = async (
  settings: ExtensionSettings,
  tabId: number,
  frameId: number | null,
  located: ZhihuLocateSuccess,
) => {
  const api = await readZhihuApi(tabId, frameId, located);
  const note = resolveZhihuNote(located, api);
  if (!note) throw new Error(t("zhihuUnreadable"));
  const body = zhihuBodyFromHtml(note.html, t("imageAltFallback"));
  if (!body.markdown && body.images.length === 0) throw new Error(t("zhihuUnreadable"));
  const images = [];
  for (const image of body.images) {
    const stored = await readTweetImage(tabId, frameId, image.url, image.alt || note.title || t("imageAltFallback"));
    if (stored) images.push({ ...stored, sourceUrl: image.url });
  }
  await saveCapturedZhihuNote(imageNoteClient(settings), {
    kind: note.kind,
    notebookId: await notebookForClip(settings),
    title: zhihuNoteTitle({
      title: note.title,
      author: note.author,
      body: body.markdown,
      fallback: t("zhihuNoteFallbackTitle"),
    }),
    author: note.author,
    noteTitle: note.title,
    body: body.markdown,
    noteUrl: note.noteUrl,
    datetime: zhihuTimeIso(note.timeSeconds),
    images,
    capturedAt: clipDateTimeText(new Date().toISOString()),
    sourceLabel: t("sourceLabel"),
    capturedAtLabel: t("capturedAtLabel"),
    timeLabel: t("tweetTimeLabel"),
    questionLabel: t("zhihuQuestionLabel"),
    articleLabel: t("zhihuArticleLabel"),
    authorLabel: t("zhihuAuthorLabel"),
    answerLabel: t("zhihuAnswerLabel"),
    articleBodyLabel: t("zhihuArticleBodyLabel"),
  });
};

const saveZhihuFromMenu = async (
  info: { pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("zhihuNotFound"));
    let located: Awaited<ReturnType<typeof readZhihuLocate>>;
    try {
      located = await readZhihuLocate(tabId, frameId);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (/cannot access|missing host permission|permission/i.test(raw)) {
        await openZhihuPermissionWindow(tabId);
        await showFeedback(tabId, frameId, t("zhihuPermissionToast"), "normal");
        return;
      }
      throw error;
    }
    if (!located.ok && located.reason === "needs-listener") {
      try {
        await injectZhihuTarget(tabId);
        await showFeedback(tabId, frameId, t("zhihuRightClickAgain"), "normal");
      } catch {
        await openZhihuPermissionWindow(tabId);
        await showFeedback(tabId, frameId, t("zhihuPermissionToast"), "normal");
      }
      return;
    }
    if (!located.ok) throw new Error(t("zhihuNotFound"));
    await showFeedback(tabId, frameId, t("savingZhihu"), "normal");
    await saveLocatedZhihu(settings, tabId, frameId, located);
    await showFeedback(tabId, frameId, t("zhihuSaved"), "success");
  } catch (error) {
    const message = describeZhihuError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const readRedditFromPage = async (tabId: number, frameId: number | null, pageUrl: string) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRedditReads.delete(requestId);
      reject(new Error(t("captureTimeout")));
    }, 12_000);
    pendingRedditReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    const target = scriptTarget(tabId, frameId);
    const inject = async () => {
      await chrome.scripting.executeScript({
        target,
        func: (value: unknown) => {
          (globalThis as { __edgeeverRedditClipPayload?: unknown }).__edgeeverRedditClipPayload = value;
        },
        args: [{ requestId, pageUrl }],
      });
      await chrome.scripting.executeScript({ target, files: ["assets/capture-reddit.js"] });
    };
    void inject().catch((error: unknown) => {
      clearTimeout(timeout);
      pendingRedditReads.delete(requestId);
      reject(new Error(describeCaptureError(error)));
    });
  });
  return result && typeof result === "object" ? result as Record<string, unknown> : {};
};

const saveRedditFromMenu = async (
  info: { pageUrl?: string; linkUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("redditNotFound"));
    const result = await readRedditFromPage(tabId, frameId, info.linkUrl || tab?.url || info.pageUrl || "");
    if (result.ok === false && result.reason === "needs-listener") {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["assets/reddit-target.js"] });
      await showFeedback(tabId, frameId, t("redditRightClickAgain"), "normal");
      return;
    }
    const id = typeof result.id === "string" ? result.id : "";
    const post = redditPostFromApi(result.api, id) ?? redditPostFromDom(result.dom, id);
    if (!post) throw new Error(t("redditNotFound"));
    await showFeedback(tabId, frameId, t("savingReddit"), "normal");
    const images = [];
    for (const image of post.images) {
      const stored = await readTweetImage(tabId, frameId, image.url, image.alt || post.title);
      if (stored) images.push({ ...stored, url: image.url });
    }
    await saveCapturedRedditPost(imageNoteClient(settings), post, {
      notebookId: await notebookForClip(settings),
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
      timeLabel: t("tweetTimeLabel"),
      authorLabel: t("redditAuthorLabel"),
      communityLabel: t("redditCommunityLabel"),
      linkLabel: t("redditLinkLabel"),
      capturedAt: clipDateTimeText(new Date().toISOString()),
      images,
    });
    await showFeedback(tabId, frameId, t("redditSaved"), "success");
  } catch (error) {
    const message = error instanceof Error && error.message === t("redditNotFound")
      ? error.message
      : error instanceof Error && error.message === "no-notebook"
        ? t("noAvailableNotebooks")
        : describeImageError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const isGithubRepoSource = (value: unknown): value is GithubRepoPageSource => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GithubRepoPageSource>;
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.every((item) => typeof item === "string");
  return typeof record.pageUrl === "string"
    && (record.repositoryNwo === undefined || typeof record.repositoryNwo === "string")
    && typeof record.openGraphDescription === "string"
    && strings(record.embeddedJsonChunks)
    && typeof record.aboutText === "string"
    && typeof record.homepage === "string"
    && strings(record.topics)
    && typeof record.license === "string"
    && typeof record.language === "string"
    && strings(record.readmeParagraphs);
};

const readGithubRepoFromPage = async (tabId: number, frameId: number | null) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingGithubReads.delete(requestId);
      reject(new Error(t("captureTimeout")));
    }, 10_000);
    pendingGithubReads.set(requestId, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    const target = scriptTarget(tabId, frameId);
    const inject = async () => {
      await chrome.scripting.executeScript({
        target,
        func: (value: unknown) => {
          (globalThis as { __edgeeverGithubClipPayload?: unknown }).__edgeeverGithubClipPayload = value;
        },
        args: [{ requestId }],
      });
      await chrome.scripting.executeScript({
        target,
        files: ["assets/capture-github.js"],
      });
    };
    void inject().catch((error: unknown) => {
      clearTimeout(timeout);
      pendingGithubReads.delete(requestId);
      reject(new Error(describeCaptureError(error)));
    });
  });
  if (!result || typeof result !== "object") return null;
  const source = (result as { source?: unknown }).source;
  if (!isGithubRepoSource(source)) return null;
  return githubRepoFactsFromSource(source);
};

const describeGithubError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (
    message === t("completePluginConfiguration")
    || message === t("instancePermissionRequired")
    || message === t("noAvailableNotebooks")
    || message === t("githubRepoNotPage")
    || message === t("githubRepoUnreadable")
    || message === t("captureTimeout")
    || message === t("pageAccessDenied")
  ) {
    return message;
  }
  const captureScriptPrefix = t("captureScriptFailed", "\u0000").split("\u0000")[0] ?? "";
  if (captureScriptPrefix && message.startsWith(captureScriptPrefix)) return message;
  return describeSaveError(error);
};

const saveGithubRepoFromMenu = async (
  info: { pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  try {
    const settings = await ensureClipperReady();
    if (!githubRepoTarget(pageUrl)) {
      await showFeedback(tabId, frameId, t("githubRepoNotPage"), "error");
      return;
    }
    if (!tabId) throw new Error(t("githubRepoUnreadable"));
    const facts = await readGithubRepoFromPage(tabId, frameId);
    if (!facts) {
      await showFeedback(tabId, frameId, t("githubRepoUnreadable"), "error");
      return;
    }
    await showFeedback(tabId, frameId, t("savingGithubRepo"), "normal");
    await createGithubRepoMemo(settings, facts);
    await showFeedback(tabId, frameId, t("githubRepoSaved"), "success");
  } catch (error) {
    const message = describeGithubError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const platformReadErrors = {
  "not-target": "platformNotDetail",
  unreadable: "platformUnreadable",
  changed: "platformPageChanged",
  incomplete: "platformIncomplete",
} as const;

const describePlatformError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (Object.values(platformReadErrors).some((key) => message === t(key))) return message;
  return describeGithubError(error);
};

const isJikeWebFeed = (url: string) => url.startsWith("https://web.okjike.com/") && !platformTarget(url);
const usesJikeWebState = (url: string) => isJikeWebFeed(url)
  || /^https:\/\/web\.okjike\.com\/u\/[^/]+\/post\/[a-f0-9]{24}\/?(?:[?#]|$)/.test(url);
const readJikeWebState = async (tabId: number, id?: string) => (await chrome.scripting.executeScript({
  target: { tabId, frameIds: [0] }, world: "MAIN", func: readJikeWebStateInPage, args: id ? [id] : [],
}))[0]?.result;

const readPlatformFromPage = async (tabId: number, target: PlatformTarget, selectionFirst: boolean, sourceUrl: string, selectionText?: string) => {
  const requestId = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPlatformReads.delete(requestId);
      reject(new Error(t("captureTimeout")));
    }, 10_000);
    pendingPlatformReads.set(requestId, { tabId, resolve: (result) => {
      clearTimeout(timeout);
      pendingPlatformReads.delete(requestId);
      resolve(result);
    } });
    const inject = async () => {
      const xiaoyuzhouState = target.platform === "xiaoyuzhou"
        ? (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func: readXiaoyuzhouStateInPage }))[0]?.result
        : undefined;
      const jikeState = target.platform === "jike" && usesJikeWebState(sourceUrl) ? await readJikeWebState(tabId,target.id) : undefined;
      const wechatPictureState = target.platform === "wechat"
        ? (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func: readWechatPictureStateInPage }))[0]?.result
        : undefined;
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: (payload: unknown) => {
          (globalThis as { __edgeeverPlatformClipPayload?: unknown }).__edgeeverPlatformClipPayload = payload;
        },
        args: [{ requestId, url: target.url, sourceUrl, selectionFirst, selectionText, xiaoyuzhouState, jikeState, wechatPictureState }],
      });
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["assets/capture-platform.js"] });
    };
    void inject().catch((error: unknown) => {
      clearTimeout(timeout);
      pendingPlatformReads.delete(requestId);
      reject(new Error(describeCaptureError(error)));
    });
  });
};

const performPlatformSave = async (tabId: number, pageUrl: string, selectionFirst: boolean, selectedUrl = pageUrl, selectionText?: string) => {
  const target = platformTarget(selectedUrl);
  if (!target) throw new Error(t("platformNotDetail"));
  const settings = await ensureClipperReady();
  const result = await readPlatformFromPage(tabId, target, selectionFirst, pageUrl, selectionText);
  if (!result || typeof result !== "object") throw new Error(t("platformUnreadable"));
  const record = result as { ok?: unknown; reason?: unknown; clip?: unknown; selection?: unknown };
  if (record.ok !== true) {
    const key = typeof record.reason === "string" && Object.hasOwn(platformReadErrors, record.reason)
      ? platformReadErrors[record.reason as keyof typeof platformReadErrors] : "platformUnreadable";
    throw new Error(t(key));
  }
  const clip = isPlatformClip(record.clip, target) ? record.clip : null;
  const selection = selectionFirst && isCapturedPage(record.selection) && record.selection.kind === "selection"
    && record.selection.url === target.url && record.selection.markdown.trim() ? record.selection : null;
  if (!clip && !selection) throw new Error(t("platformUnreadable"));
  const capturedAt = clipDateTimeText(new Date().toISOString());
  const contentMarkdown = clip ? [
    `# ${markdownText(clip.title)}`,
    clip.author ? `${t("platformAuthorLabel")}: ${[clip.author, clip.authorHeadline].filter(Boolean).map(value => markdownText(value!)).join(" · ")}` : "",
    clip.publishedAt ? `${t("platformPublishedAtLabel")}: ${markdownText(publishedTimeText(clip.publishedAt, t("platformRelativeTimeLabel")))}` : "",
    `${t("sourceLabel")}: [${markdownText(clip.url)}](${markdownUrl(clip.url)})`,
    `${t("capturedAtLabel")}: ${capturedAt}`,
    "---", clip.markdown,
  ].filter(Boolean).join("\n\n") : toMarkdown(selection!);
  const notebookId = await notebookForClip(settings);
  if (target.platform === "jike" && usesJikeWebState(pageUrl) && clip) {
    const live = await readJikeWebState(tabId,target.id);
    if (live?.pageUrl !== pageUrl || live.post.id !== target.id) throw new Error(t("platformPageChanged"));
  }
  // Notebook lookup and capture can both outlive a navigation. Bind the save
  // to the detail page the user clicked, not the next active tab or episode.
  const current = await chrome.tabs.get(tabId);
  if (current.url !== pageUrl) throw new Error(t("platformPageChanged"));
  const created = await edgeEverRequest<{ memo?: CreatedClipMemo }>(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify({ notebookId, title: (clip?.title || selection!.title).slice(0, 120), contentMarkdown, tags: clip?.tags || ["web-clip"] }),
  });
  const images = await embedClipImages(settings, created.memo, contentMarkdown, target.url, tabId, 0);
  const message = clipImageFeedback(images);
  return { ok: true, message: clip?.completeness === "no-shownotes" ? `${message} ${t("platformNoShowNotes")}` : message };
};

const savePlatformFromMenu = async (info: { pageUrl?: string; frameId?: number }, tab?: { id?: number; url?: string }) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  try {
    if (tabId === null || (info.frameId ?? 0) !== 0) throw new Error(t("platformNotDetail"));
    const pageUrl = info.pageUrl || tab?.url || "";
    let selectedUrl = pageUrl;
    if (socialPlatform(pageUrl)) {
      if (isJikeWebFeed(pageUrl)) {
        const state = await readJikeWebState(tabId);
        if (state?.pageUrl === pageUrl) selectedUrl = `https://m.okjike.com/originalPosts/${state.post.id}`;
      } else {
        const located = (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () =>
          document.querySelector("[data-edgeever-social-target]")?.getAttribute("data-edgeever-social-target") || ""
        }))[0]?.result;
        if (typeof located === "string" && platformTarget(located)?.platform === socialPlatform(pageUrl)) selectedUrl = located;
      }
      if (!platformTarget(selectedUrl)) {
        await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:["assets/social-target.js"]});
        throw new Error(t(socialPlatform(pageUrl) === "douban" ? "doubanSelectComment" : "socialSelectPost"));
      }
    }
    await showFeedback(tabId, 0, t("savingPlatformClip"), "normal");
    const result = await enqueueClip(() => performPlatformSave(tabId, pageUrl, false, selectedUrl));
    await showFeedback(tabId, 0, result.message, "success");
  } catch (error) {
    const message = describePlatformError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) await chrome.runtime.openOptionsPage();
    await showFeedback(tabId, 0, message, "error");
  }
};

const isCapturedPage = (value: unknown): value is CapturedPage => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CapturedPage>;
  return typeof record.title === "string"
    && typeof record.url === "string"
    && typeof record.markdown === "string"
    && (record.platform === undefined || record.platform === "medium" || record.platform === "substack")
    && (record.author === undefined || typeof record.author === "string")
    && (record.publishedAt === undefined || (!!record.publishedAt && typeof record.publishedAt.value === "string" && ["datetime","date","relative"].includes(record.publishedAt.precision)));
};

const readCapturedPage = async (tabId: number, frameId: number | null, mode: "page" | "selection", selectionText?: string) => {
  const requestId = crypto.randomUUID();
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingCapture?.requestId === requestId) pendingCapture = null;
      reject(new Error(t("captureTimeout")));
    }, 15_000);
    pendingCapture = { requestId, resolve: (page) => {
      clearTimeout(timeout);
      resolve(page);
    } };
    const target = scriptTarget(tabId, frameId);
    const inject = async () => {
      await chrome.scripting.executeScript({
        target,
        func: (value: unknown) => {
          (globalThis as { __edgeeverPageClipPayload?: unknown }).__edgeeverPageClipPayload = value;
        },
        args: [{ mode, requestId, selectionText }],
      });
      await chrome.scripting.executeScript({
        target,
        files: ["assets/capture.js"],
      });
    };
    void inject().catch((error: unknown) => {
      clearTimeout(timeout);
      if (pendingCapture?.requestId === requestId) pendingCapture = null;
      reject(new Error(describeCaptureError(error)));
    });
  });
  if (result && typeof result === "object" && "error" in result && result.error === "unreadable") throw new Error(t("platformUnreadable"));
  if (result && typeof result === "object" && "error" in result && result.error === "restricted") throw new Error(t("pageCaptureRestrictedHint"));
  if (!isCapturedPage(result)) throw new Error(t("captureScriptFailed", t("captureUnknownError")));
  return result;
};

const describeSelectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (
    message === t("completePluginConfiguration")
    || message === t("instancePermissionRequired")
    || message === t("noAvailableNotebooks")
    || message === t("selectionEmpty")
    || message === t("captureTimeout")
    || message === t("pageAccessDenied")
  ) {
    return message;
  }
  const captureScriptPrefix = t("captureScriptFailed", "\u0000").split("\u0000")[0] ?? "";
  if (captureScriptPrefix && message.startsWith(captureScriptPrefix)) return message;
  return describeSaveError(error);
};

const saveSelectionFromMenu = async (
  info: { pageUrl?: string; frameUrl?: string; frameId?: number; selectionText?: string },
  tab?: { id?: number; url?: string; title?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  const frameUrl = frameId && frameId > 0 ? info.frameUrl : pageUrl;
  const pageTitle = tab?.title || "";
  const browserSelection = (info.selectionText || "").replace(/\u00a0/g, " ").trim();
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("selectionEmpty"));
    const checkPage = async () => {
      if (pageUrl && (await chrome.tabs.get(tabId)).url !== pageUrl) throw new Error(t("platformPageChanged"));
    };
    await checkPage();
    await showFeedback(tabId, frameId, t("savingSelection"), "normal");

    let captured: CapturedPage | null = null;
    try {
      captured = await readCapturedPage(tabId, frameId, "selection", browserSelection || undefined);
    } catch (error) {
      if (!browserSelection) throw error;
    }
    await checkPage();
    if (captured && frameUrl && captured.url !== frameUrl) throw new Error(t("platformPageChanged"));
    const fromSelection = captured?.kind === "selection"
      && (!browserSelection || captured.plainText?.replace(/\u00a0/g, " ").trim() === browserSelection) ? captured : null;
    const markdown = fromSelection?.markdown.trim() || selectionTextMarkdown(browserSelection);
    const plain = fromSelection?.plainText?.trim() || browserSelection || markdown;
    if (!markdown.trim()) throw new Error(t("selectionEmpty"));
    const sourceUrl = fromSelection?.url || frameUrl || pageUrl;
    const contentMarkdown = selectionNoteMarkdown({
      markdown,
      pageUrl: sourceUrl,
      capturedAt: clipDateTimeText(new Date().toISOString()),
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
    });
    const notebookId = await notebookForClip(settings);
    await checkPage();
    const created = await edgeEverRequest<{ memo?: CreatedClipMemo }>(settings, "/api/v1/memos", {
      method: "POST",
      body: JSON.stringify({
        notebookId,
        title: selectionNoteTitle(plain, pageTitle, t("selectionNoteFallbackTitle")),
        contentMarkdown,
        tags: ["web-clip"],
      }),
    });
    const images=await embedClipImages(settings, created.memo, contentMarkdown, sourceUrl, tabId, frameId);
    await showFeedback(tabId, frameId, images.total ? clipImageFeedback(images) : t("selectionSaved"), "success");
  } catch (error) {
    const message = describeSelectionError(error);
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    await showFeedback(tabId, frameId, message, "error");
  }
};

const videoLabels = (): VideoNoteLabels => ({
  source: t("videoSourceLabel"),
  platform: t("videoPlatformLabel"),
  captions: t("videoCaptionsLabel"),
  capturedAt: t("videoCapturedAtLabel"),
  summary: t("videoSummaryHeading"),
  outline: t("videoOutlineHeading"),
  takeaways: t("videoTakeawaysHeading"),
  transcript: t("videoTranscriptHeading"),
  coverAlt: t("videoCoverAlt"),
  youtube: t("videoPlatformYouTube"),
  bilibili: t("videoPlatformBilibili"),
  captionsAuto: t("videoCaptionsAuto"),
  captionsCreator: t("videoCaptionsCreator"),
  noCaptions: t("videoNoCaptions"),
  fallbackTitle: t("videoNoteFallbackTitle"),
});

const videoToastMessage = (toast: VideoNoteToast) => {
  switch (toast) {
    case "saved": return t("videoNoteSaved");
    case "transcript": return t("videoTranscriptSaved");
    case "transcript-scope": return t("videoTranscriptNeedScope");
    case "transcript-model": return t("videoTranscriptNeedModel");
    case "transcript-too-long": return t("videoTranscriptTooLong");
    case "info": return t("videoInfoSaved");
    case "unsupported": return t("videoPageUnsupported");
    default: return t("videoNotRead");
  }
};

const capturedOnDate = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

const readVideoCapture = async (tabId: number, frameId: number | null, pageUrl: string) => {
  const uiLanguage = typeof chrome.i18n.getUILanguage === "function" ? chrome.i18n.getUILanguage() : "en";
  try {
    if (youtubeTargetFromUrl(pageUrl)) {
      const [injected] = await chrome.scripting.executeScript({
        target: scriptTarget(tabId, frameId),
        world: "MAIN",
        func: readYouTubeVideoInPage,
        args: [uiLanguage],
      });
      const read = injected?.result;
      if (!isYouTubePageRead(read)) return { ok: false as const, reason: "not-found" as const };
      if (!read.ok) return read;
      return youtubeCaptureFromRead(pageUrl, read);
    }
    if (bilibiliTargetFromUrl(pageUrl)) {
      const [injected] = await chrome.scripting.executeScript({
        target: scriptTarget(tabId, frameId),
        world: "MAIN",
        func: readBilibiliVideoInPage,
        args: [uiLanguage],
      });
      const read = injected?.result;
      if (!isBilibiliPageRead(read)) return { ok: false as const, reason: "not-found" as const };
      if (!read.ok) return read;
      return bilibiliCaptureFromRead(pageUrl, read);
    }
  } catch {
    return { ok: false as const, reason: "not-found" as const };
  }
  return { ok: false as const, reason: "unsupported" as const };
};

const performVideoSave = async (
  settings: ExtensionSettings,
  tabId: number,
  frameId: number | null,
  pageUrl: string,
) => {
  const read = await readVideoCapture(tabId, frameId, pageUrl);
  if (!read.ok) return { created: false, message: videoToastMessage(read.reason) };
  let attempt: OutlineAttempt | null = null;
  if (read.capture.cues.length > 0) {
    attempt = await postVideoOutline(settings, videoOutlineRequestBody(read.capture));
  }
  const saved = await persistVideoNote({
    notebookId: await notebookForClip(settings),
    capture: read.capture,
    labels: videoLabels(),
    capturedOn: capturedOnDate(),
    attempt,
    createMemo: (body) => edgeEverRequest(settings, "/api/v1/memos", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    createWithImage: (body) => imageNoteClient(settings).createWithImage(body),
  });
  return { created: true, message: videoToastMessage(saved.toast) };
};

const saveVideoFromMenu = async (
  info: { pageUrl?: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("videoNotRead"));
    await showFeedback(tabId, frameId, t("savingVideoNote"), "normal");
    const result = await performVideoSave(settings, tabId, frameId, pageUrl);
    await showFeedback(tabId, frameId, result.message, result.created ? "success" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === t("completePluginConfiguration") || message === t("instancePermissionRequired")) {
      await chrome.runtime.openOptionsPage();
    }
    const shown = message === t("completePluginConfiguration")
      || message === t("instancePermissionRequired")
      || message === t("noAvailableNotebooks")
      || message === t("videoNotRead")
      ? message
      : describeSaveError(error);
    await showFeedback(tabId, frameId, shown, "error");
  }
};

const registerClipMenus = () => {
  if (!chrome.contextMenus) return;
  // Chrome and Firefox fold an extension into a submenu when more than one of
  // its items is visible. These contexts stay disjoint so each command remains
  // on the top-level menu: a photo saves the image, selected words save the
  // passage, the rest of an X post saves the post, a GitHub repository page
  // saves the repository, the rest of a Xiaohongshu note saves the note, the
  // rest of a Zhihu answer or article or Reddit post saves that item, and a
  // YouTube or Bilibili watch page saves the video. The video patterns do not
  // share a host with those page commands. The Reddit title-link command is
  // limited to Reddit post permalinks, so linked photos keep the image command.
  // Recreate from scratch so a previous registration cannot keep an overlapping
  // item. Context menus persist across service worker and event page restarts;
  // removing them at module startup can leave the browser with no menus while
  // the background is waking up.
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    createClipMenus();
  });
};

const createClipMenus = () => {
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: t("saveSelectionToEdgeEver"),
    contexts: ["selection"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: IMAGE_MENU_ID,
    title: t("saveImageToEdgeEver"),
    contexts: ["image"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: TWEET_MENU_ID,
    title: t("saveTweetToEdgeEver"),
    contexts: ["page", "video"],
    documentUrlPatterns: TWEET_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: GITHUB_REPO_MENU_ID,
    title: t("saveGithubRepoToEdgeEver"),
    contexts: ["page"],
    documentUrlPatterns: GITHUB_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: XHS_MENU_ID,
    title: t("saveXhsToEdgeEver"),
    contexts: ["page", "video"],
    documentUrlPatterns: XHS_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: ZHIHU_MENU_ID,
    title: t("saveZhihuToEdgeEver"),
    contexts: ["page", "video"],
    documentUrlPatterns: ZHIHU_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: REDDIT_MENU_ID,
    title: t("saveRedditToEdgeEver"),
    contexts: ["page", "video"],
    documentUrlPatterns: REDDIT_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: REDDIT_LINK_MENU_ID,
    title: t("saveRedditToEdgeEver"),
    contexts: ["link"],
    documentUrlPatterns: REDDIT_DOCUMENT_PATTERNS,
    targetUrlPatterns: REDDIT_DOCUMENT_PATTERNS.map((pattern) => pattern.replace("/*", "/*/comments/*")),
  }, () => {
    void chrome.runtime.lastError;
  });
  chrome.contextMenus.create({
    id: VIDEO_MENU_ID,
    title: t("saveVideoNoteToEdgeEver"),
    contexts: ["page", "video"],
    documentUrlPatterns: VIDEO_DOCUMENT_PATTERNS,
  }, () => {
    void chrome.runtime.lastError;
  });
  for (const menu of PLATFORM_MENUS) {
    chrome.contextMenus.create({
      id: menu.id,
      title: t(menu.title),
      contexts: ["page"],
      documentUrlPatterns: [...menu.patterns],
    }, () => { void chrome.runtime.lastError; });
  }
};

chrome.runtime.onInstalled.addListener(registerClipMenus);

chrome.contextMenus?.onClicked.addListener((info: { menuItemId?: string | number; srcUrl?: string; pageUrl?: string; frameUrl?: string; linkUrl?: string; frameId?: number; selectionText?: string }, tab?: { id?: number; url?: string; title?: string }) => {
  if (PLATFORM_MENUS.some((menu) => menu.id === info.menuItemId)) {
    void savePlatformFromMenu(info, tab);
    return;
  }
  if (info.menuItemId === SELECTION_MENU_ID) {
    void enqueueClip(() => saveSelectionFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === IMAGE_MENU_ID) {
    void enqueueClip(() => saveImageFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === TWEET_MENU_ID) {
    void enqueueClip(() => saveTweetFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === GITHUB_REPO_MENU_ID) {
    void enqueueClip(() => saveGithubRepoFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === XHS_MENU_ID) {
    void enqueueClip(() => saveXhsFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === ZHIHU_MENU_ID) {
    void enqueueClip(() => saveZhihuFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === REDDIT_MENU_ID || info.menuItemId === REDDIT_LINK_MENU_ID) {
    void enqueueClip(() => saveRedditFromMenu(info, tab));
    return;
  }
  if (info.menuItemId === VIDEO_MENU_ID) {
    void enqueueClip(() => saveVideoFromMenu(info, tab));
  }
});

chrome.windows?.onRemoved.addListener((windowId: number) => {
  void chrome.storage.session.get([IMAGE_SAVE_WINDOW_KEY, TWEET_WINDOW_KEY, XHS_WINDOW_KEY, ZHIHU_WINDOW_KEY]).then((stored: Record<string, unknown>) => {
    if (stored[IMAGE_SAVE_WINDOW_KEY] === windowId) {
      void chrome.storage.session.remove(IMAGE_SAVE_WINDOW_KEY);
    }
    if (stored[TWEET_WINDOW_KEY] === windowId) {
      void chrome.storage.session.remove(TWEET_WINDOW_KEY);
    }
    if (stored[XHS_WINDOW_KEY] === windowId) {
      void chrome.storage.session.remove(XHS_WINDOW_KEY);
    }
    if (stored[ZHIHU_WINDOW_KEY] === windowId) {
      void chrome.storage.session.remove(ZHIHU_WINDOW_KEY);
    }
  }).catch(() => undefined);
});

const currentPageCaptureRoute = (pageUrl: string) => {
  if (jikeLoginPost(pageUrl)) return {kind:'login-required',platform:t('platformJike'),access:'login-required'};
  const platform = platformTarget(pageUrl);
  if (platform) return { kind:'platform', platform:({ 'hacker-news':'Hacker News', v2ex:'V2EX', xiaoyuzhou:t('platformXiaoyuzhou'), boss:t('platformBoss'), xueqiu:t('platformXueqiu'), wechat:t('platformWechat'), jike:t('platformJike'), sspai:t('platformSspai'), juejin:t('platformJuejin'), douban:t('platformDouban'), facebook:'Facebook', instagram:'Instagram', linkedin:'LinkedIn', threads:'Threads', bluesky:'Bluesky', 'substack-note':'Substack' })[platform.platform] };
  if (socialPlatform(pageUrl)) return { kind:'social-feed' };
  if (youtubeTargetFromUrl(pageUrl)) return { kind:'video',platform:'YouTube' };
  if (bilibiliTargetFromUrl(pageUrl)) return { kind:'video',platform:'Bilibili' };
  if (githubRepoTarget(pageUrl)) return { kind:'github',platform:'GitHub' };
  if (zhihuTargetFromPageUrl(pageUrl)) return { kind:'zhihu',platform:t('platformZhihu') };
  return { kind:/^https?:\/\//i.test(pageUrl) ? 'page' : 'unavailable' };
};

chrome.runtime.onMessage.addListener((message: { type?: string; page?: unknown; requestId?: string; result?: unknown }, _sender: { id?: string; tab?: { id?: number }; frameId?: number; url?: string }, sendResponse: (response: unknown) => void) => {
  if (message.type === "startRegionClip") {
    void (async () => {
      try {
        await ensureClipperReady();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error(t("currentPageNotFound"));
        if (!/^https?:\/\//i.test(tab.url || "")) throw new Error(t("pageAccessDenied"));
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["assets/region-clip.js"] }); }
        catch (error) { throw new Error(describeCaptureError(error)); }
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, message: error instanceof Error ? error.message : t("saveFailed") }); }
    })();
    return true;
  }
  if (message.type === "saveRegionClip") {
    void (async () => {
      try {
        const tabId = _sender.tab?.id;
        const page = message.page;
        if (_sender.id !== chrome.runtime.id || _sender.frameId !== 0 || typeof tabId !== "number"
          || !isCapturedPage(page) || page.kind !== "region" || !page.markdown.trim()
          || page.url !== _sender.url || !/^https?:\/\//i.test(page.url)) throw new Error(t("regionEmpty"));
        const settings = await ensureClipperReady();
        const images = await enqueueClip(() => createMemo(settings, page, tabId, page.url));
        const feedback = clipImageFeedback(images);
        await showFeedback(tabId, 0, feedback, "success");
        sendResponse({ ok: true, message: feedback });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        sendResponse({ ok: false, message: message === t("regionEmpty") || message === t("platformPageChanged") ? message : describeSelectionError(error) });
      }
    })();
    return true;
  }
  if (message.type === 'getCurrentPageCaptureMode') {
    void (async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      const route=currentPageCaptureRoute(tab?.url || '');
      if (tab?.id && platformTarget(tab.url || '')?.platform === 'boss') {
        try {
          const [read] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: bossLoginRequired });
          if ((await chrome.tabs.get(tab.id)).url !== tab.url || typeof read?.result !== 'boolean') {
            sendResponse({kind:'unknown'}); return;
          }
          sendResponse(read.result ? {...route,access:'login-required'} : route); return;
        } catch { sendResponse({kind:'unknown'}); return; }
      }
      if (route.kind === 'page' && tab?.id) {
        try {
          const [read]=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:articlePlatform});
          if (read?.result) {
            let restricted=false;
            if (read.result === 'Substack') {
              const [gate]=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:substackPaywall});
              if(typeof gate?.result !== 'boolean') {sendResponse({kind:'unknown'});return;}
              restricted=gate.result;
            }
            if ((await chrome.tabs.get(tab.id)).url !== tab.url) {sendResponse({kind:'unknown'});return;}
            sendResponse({kind:'page',platform:read.result,...(restricted ? {access:'content-restricted'} : {})});return;
          }
        } catch { /* The URL still uses the generic page capture route. */ }
      }
      sendResponse(route);
    })().catch(()=>sendResponse({kind:'unknown'}));
    return true;
  }
  if (message.type === "pagePlatformRead" && message.requestId) {
    const pending = pendingPlatformReads.get(message.requestId);
    const sender = _sender as { id?: string; tab?: { id?: number }; frameId?: number; url?: string } | undefined;
    if (pending && sender && sender.id === chrome.runtime.id && sender.tab?.id === pending.tabId && sender.frameId === 0) {
      // sender.url can retain the original document URL after SPA navigation.
      // The page reader checks its live URL; performPlatformSave checks the tab again before creation.
      pending.resolve(message.result);
    }
    return false;
  }
  if (message.type === "capturedPage" && message.page) {
    if (pendingCapture && pendingCapture.requestId === message.requestId) {
      const pending = pendingCapture;
      pendingCapture = null;
      pending.resolve(message.page);
    }
    return false;
  }

  if (message.type === "pageImageRead" && message.requestId) {
    pendingImageReads.get(message.requestId)?.(message.result);
    pendingImageReads.delete(message.requestId);
    return false;
  }

  if (message.type === "pageTweetRead" && message.requestId) {
    pendingTweetReads.get(message.requestId)?.(message.result);
    pendingTweetReads.delete(message.requestId);
    return false;
  }

  if (message.type === "pageGithubRead" && message.requestId) {
    pendingGithubReads.get(message.requestId)?.(message.result);
    pendingGithubReads.delete(message.requestId);
    return false;
  }

  if (message.type === "pageXhsRead" && message.requestId) {
    pendingXhsReads.get(message.requestId)?.(message.result);
    pendingXhsReads.delete(message.requestId);
    return false;
  }

  if (message.type === "pageZhihuRead" && message.requestId) {
    pendingZhihuReads.get(message.requestId)?.(message.result);
    pendingZhihuReads.delete(message.requestId);
    return false;
  }

  if (message.type === "pageRedditRead" && message.requestId) {
    pendingRedditReads.get(message.requestId)?.(message.result);
    pendingRedditReads.delete(message.requestId);
    return false;
  }

  if (message.type === "activateTweetTarget") {
    void (async () => {
      const stored = await chrome.storage.session.get(PENDING_TWEET_KEY);
      const pending = stored[PENDING_TWEET_KEY] as { tabId?: number | null } | undefined;
      if (typeof pending?.tabId === "number") {
        try {
          await injectTweetTarget(pending.tabId);
        } catch {
          // The tab can be saved on the next right-click after it reloads.
        }
      }
      await chrome.storage.session.remove(PENDING_TWEET_KEY);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "activateXhsTarget") {
    void (async () => {
      const stored = await chrome.storage.session.get(PENDING_XHS_KEY);
      const pending = stored[PENDING_XHS_KEY] as { tabId?: number | null } | undefined;
      if (typeof pending?.tabId === "number") {
        try {
          await injectXhsTarget(pending.tabId);
        } catch {
          // The tab can be saved on the next right-click after it reloads.
        }
      }
      await chrome.storage.session.remove(PENDING_XHS_KEY);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "activateZhihuTarget") {
    void (async () => {
      const stored = await chrome.storage.session.get(PENDING_ZHIHU_KEY);
      const pending = stored[PENDING_ZHIHU_KEY] as { tabId?: number | null } | undefined;
      if (typeof pending?.tabId === "number") {
        try {
          await injectZhihuTarget(pending.tabId);
        } catch {
          // The tab can be saved on the next right-click after it reloads.
        }
      }
      await chrome.storage.session.remove(PENDING_ZHIHU_KEY);
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "getPendingImageSave") {
    void readPendingImageSave().then((pending) => {
      sendResponse(pending ? { originPattern: pending.originPattern, host: pending.host } : null);
    }, () => sendResponse(null));
    return true;
  }

  if (message.type === "completePendingImageSave") {
    if (completingImageSave) {
      sendResponse({ ok: false, message: t("savingImage") });
      return false;
    }
    completingImageSave = true;
    void (async () => {
      const pending = await readPendingImageSave();
      if (!pending) {
        sendResponse({ ok: false, message: t("imageSaveExpired") });
        return;
      }
      try {
        await showFeedback(pending.tabId, pending.frameId, t("savingImage"), "normal");
        await saveDownloadedImage(pending, "");
        sendResponse({ ok: true });
      } catch (error) {
        const message = describeImageError(error);
        await showFeedback(pending.tabId, pending.frameId, message, "error");
        sendResponse({ ok: false, message });
      }
    })().catch((error: unknown) => {
      sendResponse({ ok: false, message: describeImageError(error) });
    }).finally(() => {
      completingImageSave = false;
    });
    return true;
  }

  if (message.type === "testConnection") {
    void (async () => {
      try {
        const settings = await getSettings();
        const notebooks = await listNotebooks(settings);
        sendResponse({ ok: true, notebooks: notebooks.notebooks });
      } catch (error) {
        sendResponse({ ok: false, message: error instanceof Error ? error.message : t("connectionFailed") });
      }
    })();
    return true;
  }

  if (message.type === "captureCurrentPage") {
    void (async () => {
      try {
        const settings = await getSettings();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          throw new Error(t("currentPageNotFound"));
        }

        const tabId = tab.id;
        const pageUrl = tab.url || "";
        const route = currentPageCaptureRoute(pageUrl);
        // Read the selection before queueing. Later edits to the source page
        // must not change this click from whole-page to selection or A to B.
        let selectionText: string | undefined;
        if (["platform", "page", "social-feed", "login-required"].includes(route.kind)) {
          try {
            const [read] = await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:()=>({url:location.href,text:window.getSelection()?.toString().replace(/\u00a0/g," ").trim() || ""})});
            if (read?.result?.url !== pageUrl) throw new Error(t("platformPageChanged"));
            selectionText = read.result.text;
          } catch (error) {
            if (error instanceof Error && error.message === t("platformPageChanged")) throw error;
            throw new Error(describeCaptureError(error));
          }
        }
        await enqueueClip(async () => {
          if ((await chrome.tabs.get(tabId)).url !== pageUrl) throw new Error(t("platformPageChanged"));
          if (route.kind === 'login-required' || route.kind === 'social-feed') {
            try {
              const emptyMessage = route.kind === 'login-required' ? t('platformUnreadable')
                : t(socialPlatform(pageUrl) === "douban" ? "doubanSelectComment" : "socialSelectPost");
              const selection = selectionText;
              if (!selection) {sendResponse({ok:false,message:emptyMessage});return;}
              const page = await readCapturedPage(tabId, null, "selection", selectionText);
              if (page.url !== pageUrl) throw new Error(t("platformPageChanged"));
              if (page.kind !== "selection" || !page.markdown.trim()) {sendResponse({ok:false,message:emptyMessage});return;}
              const images=await createMemo(settings, page, tabId, pageUrl);
              sendResponse({ok:true,message:clipImageFeedback(images)});
            } catch (error) {
              sendResponse({ok:false,message:describePlatformError(error)});
            }
            return;
          }
          if (route.kind === 'platform') {
            try {
              sendResponse(await performPlatformSave(tabId, pageUrl, true, pageUrl, selectionText));
            } catch (error) {
              sendResponse({ ok: false, message: describePlatformError(error) });
            }
            return;
          }
          if (route.kind === 'video') {
            const result = await performVideoSave(settings, tabId, null, pageUrl);
            sendResponse(result.created ? { ok: true, message: result.message } : { ok: false, message: result.message });
            return;
          }

          if (route.kind === 'github') {
            let facts: GithubRepoFacts | null = null;
            try {
              facts = await readGithubRepoFromPage(tabId, null);
            } catch {
              // The repository card is unavailable. Save the page as an article.
            }
            if (facts) {
              await createGithubRepoMemo(settings, facts);
              sendResponse({ ok: true });
              return;
            }
          }

          if (route.kind === 'zhihu') {
            const located = await readZhihuLocate(tabId, null);
            if (!located.ok) throw new Error(t("zhihuNotFound"));
            await saveLocatedZhihu(settings, tabId, null, located);
            sendResponse({ ok: true });
            return;
          }

          const page = await readCapturedPage(tabId, null, "page", selectionText);
          if (page.url !== pageUrl) throw new Error(t("platformPageChanged"));
          const images = await createMemo(settings, page, tabId, pageUrl);
          sendResponse({ ok: true, message: clipImageFeedback(images) });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        sendResponse({
          ok: false,
          message: message === t("zhihuNotFound") || message === t("zhihuUnreadable") || message === t("pageAccessDenied") || message === t("platformPageChanged") || message === t("pageCaptureRestrictedHint")
            ? message
            : message === t("captureTimeout") || message.startsWith(t("captureScriptFailed", ""))
              ? describeCaptureError(error)
              : describeSaveError(error),
        });
      }
    })();
    return true;
  }

  return false;
});
