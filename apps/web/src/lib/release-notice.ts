const DISMISSED_RELEASE_KEY = "edgeever:dismissed-release";
export const RELEASE_STATUS_EVENT = "edgeever:release-status";

export const getDismissedRelease = () => {
  try {
    return window.localStorage.getItem(DISMISSED_RELEASE_KEY);
  } catch {
    return null;
  }
};

export const dismissRelease = (tagName: string) => {
  try {
    window.localStorage.setItem(DISMISSED_RELEASE_KEY, tagName);
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }
  window.dispatchEvent(new CustomEvent(RELEASE_STATUS_EVENT, { detail: { tagName, dismissed: true } }));
};
