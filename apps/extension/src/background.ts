import {
  edgeEverFormRequest,
  edgeEverRequest,
  getInstanceOrigin,
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
  githubRepoFactsFromSource,
  githubRepoNoteMarkdown,
  githubRepoNoteTitle,
  githubRepoTarget,
  type GithubRepoFacts,
  type GithubRepoPageSource,
} from "./github-repo";
import {
  selectionNoteMarkdown,
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

type CapturedPage = {
  title: string;
  url: string;
  markdown: string;
  plainText?: string;
  kind?: "page" | "selection";
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
  const capturedAt = new Date().toISOString();
  return `# ${page.title.replace(/\n/g, " ")}\n\n${t("sourceLabel")}: [${page.url}](${page.url})\n\n${t("capturedAtLabel")}: ${capturedAt}\n\n---\n\n${page.markdown}`;
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
  const notebookId = settings.notebookId || notebooks.notebooks[0]?.id;
  if (!notebookId) throw new Error(t("noAvailableNotebooks"));
  return notebookId;
};

const createMemo = async (settings: ExtensionSettings, page: CapturedPage) => {
  await edgeEverRequest(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify({
      notebookId: await notebookForClip(settings),
      title: page.title,
      contentMarkdown: toMarkdown(page),
      tags: ["web-clip"],
    }),
  });
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
        capturedAt: new Date().toISOString(),
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
  uploadImage: async (memoId, file) => {
    const uploaded = await uploadMemoImage(settings, memoId, file);
    return uploaded.resource;
  },
  createEditSession: (memoId) => edgeEverRequest(
    settings,
    `/api/v1/memos/${encodeURIComponent(memoId)}/edit-sessions`,
    { method: "POST", body: JSON.stringify({}) },
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

const injectImageHelper = async (tabId: number, frameId: number | null, payload: unknown) => {
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
    files: ["assets/capture-image.js"],
  });
};

const showFeedback = async (
  tabId: number | null,
  frameId: number | null,
  message: string,
  kind: "success" | "error",
) => {
  if (tabId) {
    try {
      await injectImageHelper(tabId, frameId, { action: "toast", message, kind });
      return;
    } catch {
      // Restricted pages cannot host the toast. The toolbar badge still reports the result.
    }
  }
  await chrome.action.setBadgeBackgroundColor({ color: kind === "error" ? "#b91c1c" : "#0f766e" });
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
  const granted = await chrome.permissions.contains({ origins: [`${getInstanceOrigin(settings.instanceUrl)}/*`] });
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
      notebookId: settings.notebookId,
      title: noteTitleForImage(context.pageTitle, context.alt, t("imageNoteFallbackTitle")),
      alt: context.alt,
      filename: filenameForImage(context.srcUrl, image.mimeType),
      mimeType: image.mimeType,
      bytes: image.bytes,
      pageUrl: context.pageUrl,
      capturedAt: new Date().toISOString(),
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

const downloadImage = async (urls: string[]): Promise<StoredImage | StoredImageFailure> => {
  const matchUrl = urls[urls.length - 1] ?? "";
  let matchError: StoredImageFailure["error"] | "" = "";
  for (const url of urls) {
    if (!/^https?:/i.test(url)) continue;
    for (const credentials of ["omit", "include"] as const) {
      try {
        const response = await fetch(url, { credentials });
        if (!response.ok) continue;
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
          if (url === matchUrl) matchError = "too-large";
          continue;
        }
        const image = imageFromBytes(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type") ?? "");
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

let pendingCapture: ((page: CapturedPage) => void) | null = null;
const pendingImageReads = new Map<string, (result: unknown) => void>();
const pendingTweetReads = new Map<string, (result: unknown) => void>();
const pendingGithubReads = new Map<string, (result: unknown) => void>();
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
    await showFeedback(tabId, frameId, t("savingImage"), "success");
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
    await showFeedback(tabId, frameId, t("imagePermissionToast"), "success");
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
      await showFeedback(tabId, frameId, t("tweetPermissionToast"), "success");
      return;
    }

    await showFeedback(tabId, frameId, t("savingTweet"), "success");
    const tweet = await readTweetFromPage(tabId, frameId, statusId);
    if (!tweet.ok && tweet.reason === "needs-listener") {
      await injectTweetTarget(tabId);
      await showFeedback(tabId, frameId, t("tweetRightClickAgain"), "success");
      return;
    }
    if (!tweet.ok) throw new Error(t("tweetNotFound"));

    const images = [];
    for (const image of tweet.images) {
      const stored = await readTweetImage(tabId, frameId, image.url, image.alt);
      if (stored) images.push(stored);
    }
    await saveCapturedTweetNote(imageNoteClient(settings), {
      notebookId: settings.notebookId,
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
      capturedAt: new Date().toISOString(),
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
      await showFeedback(tabId, frameId, t("xhsPermissionToast"), "success");
      return;
    }

    await showFeedback(tabId, frameId, t("savingXhs"), "success");
    const page = await readXhsStateFromPage(tabId, frameId) ?? await readXhsFromPage(tabId, frameId);
    if (!page.ok && page.reason === "needs-listener") {
      await injectXhsTarget(tabId);
      await showFeedback(tabId, frameId, t("xhsRightClickAgain"), "success");
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
      notebookId: settings.notebookId,
      title: xhsNoteTitle({ ...note, fallback: t("xhsNoteFallbackTitle") }),
      nickname: note.nickname,
      noteTitle: note.title,
      body: note.body,
      datetime: note.datetime,
      location: note.location,
      noteUrl: note.noteUrl,
      images,
      capturedAt: new Date().toISOString(),
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
    notebookId: settings.notebookId,
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
    capturedAt: new Date().toISOString(),
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
        await showFeedback(tabId, frameId, t("zhihuPermissionToast"), "success");
        return;
      }
      throw error;
    }
    if (!located.ok && located.reason === "needs-listener") {
      try {
        await injectZhihuTarget(tabId);
        await showFeedback(tabId, frameId, t("zhihuRightClickAgain"), "success");
      } catch {
        await openZhihuPermissionWindow(tabId);
        await showFeedback(tabId, frameId, t("zhihuPermissionToast"), "success");
      }
      return;
    }
    if (!located.ok) throw new Error(t("zhihuNotFound"));
    await showFeedback(tabId, frameId, t("savingZhihu"), "success");
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
      await showFeedback(tabId, frameId, t("redditRightClickAgain"), "success");
      return;
    }
    const id = typeof result.id === "string" ? result.id : "";
    const post = redditPostFromApi(result.api, id) ?? redditPostFromDom(result.dom, id);
    if (!post) throw new Error(t("redditNotFound"));
    await showFeedback(tabId, frameId, t("savingReddit"), "success");
    const images = [];
    for (const image of post.images) {
      const stored = await readTweetImage(tabId, frameId, image.url, image.alt || post.title);
      if (stored) images.push({ ...stored, url: image.url });
    }
    await saveCapturedRedditPost(imageNoteClient(settings), post, {
      notebookId: settings.notebookId,
      sourceLabel: t("sourceLabel"),
      capturedAtLabel: t("capturedAtLabel"),
      timeLabel: t("tweetTimeLabel"),
      authorLabel: t("redditAuthorLabel"),
      communityLabel: t("redditCommunityLabel"),
      linkLabel: t("redditLinkLabel"),
      capturedAt: new Date().toISOString(),
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
    await showFeedback(tabId, frameId, t("savingGithubRepo"), "success");
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

const isCapturedPage = (value: unknown): value is CapturedPage => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CapturedPage>;
  return typeof record.title === "string"
    && typeof record.url === "string"
    && typeof record.markdown === "string";
};

const readCapturedPage = async (tabId: number, frameId: number | null, mode: "page" | "selection") => {
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCapture = null;
      reject(new Error(t("captureTimeout")));
    }, 15_000);
    pendingCapture = (page) => {
      clearTimeout(timeout);
      resolve(page);
    };
    const target = scriptTarget(tabId, frameId);
    const inject = async () => {
      await chrome.scripting.executeScript({
        target,
        func: (value: unknown) => {
          (globalThis as { __edgeeverPageClipPayload?: unknown }).__edgeeverPageClipPayload = value;
        },
        args: [{ mode }],
      });
      await chrome.scripting.executeScript({
        target,
        files: ["assets/capture.js"],
      });
    };
    void inject().catch((error: unknown) => {
      clearTimeout(timeout);
      pendingCapture = null;
      reject(new Error(describeCaptureError(error)));
    });
  });
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
  info: { pageUrl?: string; frameId?: number; selectionText?: string },
  tab?: { id?: number; url?: string; title?: string },
) => {
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const frameId = typeof info.frameId === "number" ? info.frameId : null;
  const pageUrl = tab?.url || info.pageUrl || "";
  const pageTitle = tab?.title || "";
  const browserSelection = (info.selectionText || "").replace(/\u00a0/g, " ").trim();
  try {
    const settings = await ensureClipperReady();
    if (!tabId) throw new Error(t("selectionEmpty"));
    await showFeedback(tabId, frameId, t("savingSelection"), "success");
    let captured: CapturedPage | null = null;
    try {
      captured = await readCapturedPage(tabId, frameId, "selection");
    } catch (error) {
      if (!browserSelection) throw error;
    }
    const fromSelection = captured?.kind === "selection" ? captured : null;
    const markdown = fromSelection?.markdown.trim() || browserSelection;
    const plain = fromSelection?.plainText?.trim() || browserSelection || markdown;
    if (!markdown.trim()) throw new Error(t("selectionEmpty"));
    await edgeEverRequest(settings, "/api/v1/memos", {
      method: "POST",
      body: JSON.stringify({
        notebookId: await notebookForClip(settings),
        title: selectionNoteTitle(plain, pageTitle, t("selectionNoteFallbackTitle")),
        contentMarkdown: selectionNoteMarkdown({
          markdown,
          pageUrl: fromSelection?.url || pageUrl,
          capturedAt: new Date().toISOString(),
          sourceLabel: t("sourceLabel"),
          capturedAtLabel: t("capturedAtLabel"),
        }),
        tags: ["web-clip"],
      }),
    });
    await showFeedback(tabId, frameId, t("selectionSaved"), "success");
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
    await showFeedback(tabId, frameId, t("savingVideoNote"), "success");
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
};

chrome.runtime.onInstalled.addListener(registerClipMenus);

chrome.contextMenus.onClicked.addListener((info: { menuItemId?: string | number; srcUrl?: string; pageUrl?: string; linkUrl?: string; frameId?: number; selectionText?: string }, tab?: { id?: number; url?: string; title?: string }) => {
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

chrome.windows.onRemoved.addListener((windowId: number) => {
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

chrome.runtime.onMessage.addListener((message: { type?: string; page?: CapturedPage; requestId?: string; result?: unknown }, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (message.type === "capturedPage" && message.page) {
    pendingCapture?.(message.page);
    pendingCapture = null;
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
        await showFeedback(pending.tabId, pending.frameId, t("savingImage"), "success");
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

        const pageUrl = tab.url || "";
        if (youtubeTargetFromUrl(pageUrl) || bilibiliTargetFromUrl(pageUrl)) {
          const result = await enqueueClip(() => performVideoSave(settings, tab.id, null, pageUrl));
          sendResponse(result.created ? { ok: true, message: result.message } : { ok: false, message: result.message });
          return;
        }

        if (githubRepoTarget(pageUrl)) {
          let facts: GithubRepoFacts | null = null;
          try {
            facts = await readGithubRepoFromPage(tab.id, null);
          } catch {
            // The repository card is unavailable. Save the page as an article.
          }
          if (facts) {
            await createGithubRepoMemo(settings, facts);
            sendResponse({ ok: true });
            return;
          }
        }

        if (zhihuTargetFromPageUrl(pageUrl)) {
          const located = await readZhihuLocate(tab.id, null);
          if (!located.ok) throw new Error(t("zhihuNotFound"));
          await saveLocatedZhihu(settings, tab.id, null, located);
          sendResponse({ ok: true });
          return;
        }

        const page = await readCapturedPage(tab.id, null, "page");
        await createMemo(settings, page);
        sendResponse({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        sendResponse({
          ok: false,
          message: message === t("zhihuNotFound") || message === t("zhihuUnreadable")
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
