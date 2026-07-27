import {
  edgeEverRequest,
  getSettings,
  listNotebooks,
  type ExtensionSettings,
} from "./extension";
import { t } from "./i18n";

type CapturedPage = {
  title: string;
  url: string;
  markdown: string;
};

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
  if (/cannot access (contents|a page)|extensions gallery|chrome:\/\/|edge:\/\/|about:\/\//i.test(message)) {
    return t("pageAccessDenied");
  }
  return t("captureScriptFailed", message || t("captureUnknownError"));
};

const describeSaveError = (error: unknown) => {
  const message = compactError(error);
  if (/failed to fetch|networkerror|load failed|network request/i.test(message)) {
    return t("instanceNetworkFailed");
  }
  return t("saveFailedWithReason", message || t("saveFailed"));
};

const createMemo = async (settings: ExtensionSettings, page: CapturedPage) => {
  const notebooks = await listNotebooks(settings);
  const notebookId = settings.notebookId || notebooks.notebooks[0]?.id;
  if (!notebookId) {
    throw new Error(t("noAvailableNotebooks"));
  }

  await edgeEverRequest(settings, "/api/v1/memos", {
    method: "POST",
    body: JSON.stringify({
      notebookId,
      title: page.title,
      contentMarkdown: toMarkdown(page),
      tags: ["web-clip"],
    }),
  });
};

let pendingCapture: ((page: CapturedPage) => void) | null = null;

chrome.runtime.onMessage.addListener((message: { type?: string; page?: CapturedPage }, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (message.type === "capturedPage" && message.page) {
    pendingCapture?.(message.page);
    pendingCapture = null;
    return false;
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

        const page = await new Promise<CapturedPage>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingCapture = null;
            reject(new Error(t("captureTimeout")));
          }, 15_000);

          pendingCapture = (capturedPage) => {
            clearTimeout(timeout);
            resolve(capturedPage);
          };

          void chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["assets/capture.js"],
          }).catch((error: unknown) => {
            clearTimeout(timeout);
            pendingCapture = null;
            reject(new Error(describeCaptureError(error)));
          });
        });
        await createMemo(settings, page);
        sendResponse({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        sendResponse({
          ok: false,
          message: message === t("captureTimeout") || message.startsWith(t("captureScriptFailed", ""))
            ? describeCaptureError(error)
            : describeSaveError(error),
        });
      }
    })();
    return true;
  }

  return false;
});
