import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadContentDispositionFromRequest, resourceIdFromRequest } from "./resource-url.mjs";

export const isResourceDownloadUrl = (targetUrl) => {
  try {
    const target = new URL(targetUrl);
    return ["edgeever-resource:", "edgeever-staged:"].includes(target.protocol)
      && !target.username && !target.password && !target.port
      && (target.protocol === "edgeever-resource:"
        ? target.hostname === "resource" && target.pathname.length > 1
        : Boolean(target.hostname) && ["", "/"].includes(target.pathname))
      && Boolean(resourceIdFromRequest(targetUrl))
      && Boolean(downloadContentDispositionFromRequest(targetUrl));
  } catch { return false; }
};

export const isAllowedAppNavigation = (targetUrl, appUrl) => {
  try {
    const target = new URL(targetUrl);
    const expected = new URL(appUrl);
    if (target.username || target.password || target.protocol !== expected.protocol) return false;
    if (target.protocol === "file:") return target.host === expected.host && target.pathname === expected.pathname;
    return ["http:", "https:", "edgeever-app:"].includes(target.protocol)
      && target.hostname === expected.hostname && target.port === expected.port;
  } catch { return false; }
};

export const isAllowedPrintPreviewUrl = (targetUrl, appUrl) => {
  try {
    const target = new URL(targetUrl);
    const currentApp = new URL(appUrl);
    if (target.username || target.password) return false;

    if (currentApp.protocol === "file:") {
      const expected = pathToFileURL(join(dirname(fileURLToPath(currentApp)), "note-print.html"));
      return target.protocol === "file:" && target.pathname === expected.pathname;
    }

    const expected = new URL("/note-print.html", currentApp);
    return target.protocol === expected.protocol &&
      target.hostname === expected.hostname &&
      target.port === expected.port &&
      target.pathname === expected.pathname;
  } catch {
    return false;
  }
};

export const createAppWindowOpenHandler = ({ getAppUrl, printPreloadPath, openExternal }) => ({ url }) => {
  if (isAllowedPrintPreviewUrl(url, getAppUrl())) {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: printPreloadPath,
        },
      },
    };
  }
  if (url.startsWith("https://") || url.startsWith("http://")) void openExternal(url);
  return { action: "deny" };
};
