export const isSafeResourceId = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._~-]+$/.test(value) && value !== "." && value !== "..";

export const resourceIdFromRequest = (requestUrl) => {
  try {
    const url = new URL(requestUrl);
    const pathId = url.pathname.replace(/^\//, "");
    const id = decodeURIComponent(pathId || url.hostname);
    return isSafeResourceId(id) ? id : null;
  } catch {
    return null;
  }
};
