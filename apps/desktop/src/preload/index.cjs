const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("edgeeverDesktop", Object.freeze({
  isAvailable: true,
  sidecarStatus: () => ipcRenderer.invoke("desktop:sidecar-status"),
  setAccountScope: (accountId) => ipcRenderer.invoke("desktop:set-account-scope", accountId),
  apiBaseUrl: ipcRenderer.sendSync("desktop:api-base-url-sync"),
  setApiBaseUrl: (value) => ipcRenderer.invoke("desktop:set-api-base-url", value),
  getSessionToken: () => ipcRenderer.sendSync("desktop:session-token-sync"),
  copyText: (value) => ipcRenderer.invoke("desktop:copy-text", value),
  copyHtml: (html, plainText) => ipcRenderer.invoke("desktop:copy-html", { html, plainText }),
  setSessionToken: (value) => ipcRenderer.invoke("desktop:set-session-token", value),
  clearSessionToken: () => ipcRenderer.invoke("desktop:clear-session-token"),
  updateStatus: () => ipcRenderer.invoke("desktop:update-status"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  sidecarRequest: (method, params = {}) => ipcRenderer.invoke("desktop:sidecar-request", method, params),
  stageResource: (input) => ipcRenderer.invoke("desktop:stage-resource", input),
  listStagedResources: () => ipcRenderer.invoke("desktop:list-staged-resources"),
  remapStagedResourceMemoIds: (mappings) => ipcRenderer.invoke("desktop:remap-staged-resource-memo-ids", mappings),
  readStagedResource: (id) => ipcRenderer.invoke("desktop:read-staged-resource", id),
  removeStagedResource: (id) => ipcRenderer.invoke("desktop:remove-staged-resource", id),
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("desktop:command", listener);
    return () => ipcRenderer.removeListener("desktop:command", listener);
  },
  onImportMarkdown: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:import-markdown", listener);
    ipcRenderer.send("desktop:renderer-ready");
    return () => ipcRenderer.removeListener("desktop:import-markdown", listener);
  },
}));
