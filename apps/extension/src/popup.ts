import "./styles.css";
import { getSettings, requestInstancePermission, type ExtensionSettings } from "./extension";
import { localizeDocument, t } from "./i18n";

localizeDocument();

const saveButton = document.querySelector<HTMLButtonElement>("#save");
const settingsButton = document.querySelector<HTMLButtonElement>("#settings");
const status = document.querySelector<HTMLParagraphElement>("#status");
let settings: ExtensionSettings | null = null;

const setStatus = (message: string, kind: "normal" | "error" | "success" = "normal") => {
  if (status) {
    status.textContent = message;
    status.dataset.kind = kind;
  }
};

if (saveButton) saveButton.disabled = true;
void getSettings().then((loadedSettings) => {
  settings = loadedSettings;
  if (saveButton) saveButton.disabled = false;
}).catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : t("saveFailed"), "error");
});

saveButton?.addEventListener("click", async () => {
  if (!settings) return;
  saveButton.disabled = true;
  setStatus(t("readingAndSaving"));

  try {
    if (!settings.instanceUrl || !settings.token) {
      throw new Error(t("completePluginConfiguration"));
    }

    await requestInstancePermission(settings.instanceUrl);
    const response = await chrome.runtime.sendMessage({ type: "captureCurrentPage" });
    if (!response?.ok) {
      throw new Error(response?.message || t("saveFailed"));
    }

    setStatus(t("savedToEdgeEver"), "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : t("saveFailed"), "error");
  } finally {
    saveButton.disabled = false;
  }
});

settingsButton?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
