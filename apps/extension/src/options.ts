import "./styles.css";
import { getSettings, saveSettings, testConnection, type ExtensionSettings } from "./extension";

type NotebookSelect = {
  value: string;
  replaceChildren: (...nodes: Node[]) => void;
  add: (option: HTMLOptionElement) => void;
};

const form = document.querySelector<HTMLFormElement>("#settings-form");
const instanceUrlInput = document.querySelector<HTMLInputElement>("#instance-url");
const tokenInput = document.querySelector<HTMLInputElement>("#token");
const notebookSelect = document.querySelector("#notebook-id") as NotebookSelect | null;
const testButton = document.querySelector<HTMLButtonElement>("#test");
const status = document.querySelector<HTMLParagraphElement>("#status");

const setStatus = (message: string, kind: "normal" | "error" | "success" = "normal") => {
  if (status) {
    status.textContent = message;
    status.dataset.kind = kind;
  }
};

const readSettings = (): ExtensionSettings => ({
  instanceUrl: instanceUrlInput?.value.trim() ?? "",
  token: tokenInput?.value.trim() ?? "",
  notebookId: notebookSelect?.value ?? "",
});

const renderNotebooks = (notebooks: Array<{ id: string; name: string }>, selectedId: string) => {
  if (!notebookSelect) {
    return;
  }

  notebookSelect.replaceChildren(new Option("连接后自动使用第一个笔记本", ""));
  for (const notebook of notebooks) {
    notebookSelect.add(new Option(notebook.name, notebook.id));
  }
  notebookSelect.value = selectedId;
};

const initialize = async () => {
  const settings = await getSettings();
  if (instanceUrlInput) instanceUrlInput.value = settings.instanceUrl;
  if (tokenInput) tokenInput.value = settings.token;
  if (notebookSelect) notebookSelect.value = settings.notebookId;
};

testButton?.addEventListener("click", async () => {
  testButton.disabled = true;
  setStatus("正在连接……");
  try {
    const settings = readSettings();
    const notebooks = await testConnection(settings);
    renderNotebooks(notebooks, notebookSelect?.value ?? "");
    setStatus(`连接成功，共 ${notebooks.length} 个笔记本。`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "连接失败。", "error");
  } finally {
    testButton.disabled = false;
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveSettings(readSettings());
    setStatus("设置已保存。", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "保存失败。", "error");
  }
});

void initialize();
