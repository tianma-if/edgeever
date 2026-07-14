export type ExtensionSettings = {
  instanceUrl: string;
  token: string;
  notebookId: string;
};

export type Notebook = {
  id: string;
  name: string;
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  instanceUrl: "",
  token: "",
  notebookId: "",
};

export const getSettings = async (): Promise<ExtensionSettings> => {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    instanceUrl: typeof stored.instanceUrl === "string" ? stored.instanceUrl : "",
    token: typeof stored.token === "string" ? stored.token : "",
    notebookId: typeof stored.notebookId === "string" ? stored.notebookId : "",
  };
};

export const saveSettings = async (settings: ExtensionSettings) => {
  await chrome.storage.local.set(settings);
};

export const normalizeInstanceUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
};

export const getInstanceOrigin = (instanceUrl: string) => {
  const url = new URL(normalizeInstanceUrl(instanceUrl));
  return url.origin;
};

export const requestInstancePermission = async (instanceUrl: string) => {
  const origin = getInstanceOrigin(instanceUrl);
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    throw new Error("需要允许插件访问你的 EdgeEver 实例。");
  }
};

export const edgeEverRequest = async <T>(settings: ExtensionSettings, path: string, init?: RequestInit): Promise<T> => {
  const instanceUrl = normalizeInstanceUrl(settings.instanceUrl);
  if (!instanceUrl || !settings.token) {
    throw new Error("请先在插件设置中填写 EdgeEver 地址和 API Token。");
  }

  const response = await fetch(`${instanceUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `EdgeEver 请求失败（${response.status}）。`);
  }

  return response.json() as Promise<T>;
};

export const listNotebooks = (settings: ExtensionSettings) =>
  edgeEverRequest<{ notebooks: Notebook[] }>(settings, "/api/v1/notebooks");

export const testConnection = async (settings: ExtensionSettings) => {
  await requestInstancePermission(settings.instanceUrl);
  const result = await listNotebooks(settings);
  return result.notebooks;
};
