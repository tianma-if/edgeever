import "./styles.css";
import { getSettings, requestInstancePermission } from "./extension";

const saveButton = document.querySelector<HTMLButtonElement>("#save");
const settingsButton = document.querySelector<HTMLButtonElement>("#settings");
const status = document.querySelector<HTMLParagraphElement>("#status");

const setStatus = (message: string, kind: "normal" | "error" | "success" = "normal") => {
  if (status) {
    status.textContent = message;
    status.dataset.kind = kind;
  }
};

saveButton?.addEventListener("click", async () => {
  saveButton.disabled = true;
  setStatus("正在读取网页并保存……");

  try {
    const settings = await getSettings();
    if (!settings.instanceUrl || !settings.token) {
      throw new Error("请先打开插件设置。");
    }

    await requestInstancePermission(settings.instanceUrl);
    const response = await chrome.runtime.sendMessage({ type: "captureCurrentPage" });
    if (!response?.ok) {
      throw new Error(response?.message || "保存失败。");
    }

    setStatus("已保存到 EdgeEver。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "保存失败。", "error");
  } finally {
    saveButton.disabled = false;
  }
});

settingsButton?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
