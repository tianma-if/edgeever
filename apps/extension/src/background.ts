import {
  edgeEverRequest,
  getSettings,
  listNotebooks,
  type ExtensionSettings,
} from "./extension";

type CapturedPage = {
  title: string;
  url: string;
  markdown: string;
};

const toMarkdown = (page: CapturedPage) => {
  const capturedAt = new Date().toISOString();
  return `# ${page.title.replace(/\n/g, " ")}\n\n来源：[${page.url}](${page.url})\n\n抓取时间：${capturedAt}\n\n---\n\n${page.markdown}`;
};

const createMemo = async (settings: ExtensionSettings, page: CapturedPage) => {
  const notebooks = await listNotebooks(settings);
  const notebookId = settings.notebookId || notebooks.notebooks[0]?.id;
  if (!notebookId) {
    throw new Error("EdgeEver 中没有可用的笔记本。");
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
        sendResponse({ ok: false, message: error instanceof Error ? error.message : "连接失败。" });
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
          throw new Error("找不到当前页面。");
        }

        const page = await new Promise<CapturedPage>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingCapture = null;
            reject(new Error("网页内容提取超时，请重试。"));
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
            reject(error);
          });
        });
        await createMemo(settings, page);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, message: error instanceof Error ? error.message : "保存失败。" });
      }
    })();
    return true;
  }

  return false;
});
