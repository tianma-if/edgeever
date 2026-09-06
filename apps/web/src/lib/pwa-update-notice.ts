export const PWA_UPDATE_NOTICE_EVENT = "edgeever:pwa-update-notice";
export const DEPLOYED_UPDATE_SEEN_EVENT = "edgeever:deployed-update-seen";

const DEPLOYED_RELEASE_ID_KEY = "edgeever:deployed-release-id:v1";
const DEPLOYED_SEEN_RELEASE_ID_KEY = "edgeever:deployed-seen-release-id:v1";

const scopedStorageKey = (key: string, scope?: string) =>
  scope ? `${key}:${encodeURIComponent(scope)}` : key;

export type PwaUpdateNoticeKind = "checking" | "reload-required";

export type PwaUpdateNoticeDetail = {
  kind: PwaUpdateNoticeKind;
};

export type PwaUpdateNoticeEvent = CustomEvent<PwaUpdateNoticeDetail>;

export const emitPwaUpdateNotice = (detail: PwaUpdateNoticeDetail) => {
  window.dispatchEvent(new CustomEvent<PwaUpdateNoticeDetail>(PWA_UPDATE_NOTICE_EVENT, { detail }));
};

export const hasUnseenDeployedUpdate = (currentReleaseId: string, scope?: string) => {
  try {
    const releaseIdKey = scopedStorageKey(DEPLOYED_RELEASE_ID_KEY, scope);
    const seenReleaseIdKey = scopedStorageKey(DEPLOYED_SEEN_RELEASE_ID_KEY, scope);
    const previousReleaseId = window.localStorage.getItem(releaseIdKey);
    const seenReleaseId = window.localStorage.getItem(seenReleaseIdKey);

    if (!previousReleaseId) {
      window.localStorage.setItem(releaseIdKey, currentReleaseId);
      window.localStorage.setItem(seenReleaseIdKey, currentReleaseId);
      return false;
    }

    if (previousReleaseId !== currentReleaseId) {
      window.localStorage.setItem(releaseIdKey, currentReleaseId);
    }

    if (!seenReleaseId) {
      window.localStorage.setItem(seenReleaseIdKey, previousReleaseId);
      return previousReleaseId !== currentReleaseId;
    }

    return seenReleaseId !== currentReleaseId;
  } catch {
    return false;
  }
};

export const markDeployedUpdateSeen = (currentReleaseId: string, scope?: string) => {
  try {
    window.localStorage.setItem(scopedStorageKey(DEPLOYED_RELEASE_ID_KEY, scope), currentReleaseId);
    window.localStorage.setItem(scopedStorageKey(DEPLOYED_SEEN_RELEASE_ID_KEY, scope), currentReleaseId);
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }
  window.dispatchEvent(new Event(DEPLOYED_UPDATE_SEEN_EVENT));
};
