import { useQuery } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import {
  DEPLOYED_UPDATE_SEEN_EVENT,
  hasUnseenDeployedUpdate,
  markDeployedUpdateSeen,
} from "@/lib/pwa-update-notice";
import { api, getConfiguredDesktopApiBaseUrl, type InstanceRelease } from "@/lib/api";
import { getReleaseTagForVersion } from "@/lib/version-check";

const isDesktopClient = () => window.edgeeverDesktop?.isAvailable === true;
const bundledRelease: InstanceRelease = {
  version: __EDGEEVER_RELEASE_SUMMARY__.version,
  changes: __EDGEEVER_RELEASE_SUMMARY__.changes,
};

const subscribe = (notify: () => void) => {
  window.addEventListener(DEPLOYED_UPDATE_SEEN_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(DEPLOYED_UPDATE_SEEN_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
};

export const useDeployedUpdateNotice = () => {
  const desktopClient = isDesktopClient();
  const instanceUrl = desktopClient ? getConfiguredDesktopApiBaseUrl() : "";
  const releaseQuery = useQuery({
    queryKey: ["instance-release", instanceUrl],
    queryFn: () => api.getInstanceRelease(),
    enabled: desktopClient && Boolean(instanceUrl),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const release = desktopClient ? releaseQuery.data ?? null : bundledRelease;
  const releaseId = release
    ? getReleaseTagForVersion(release.version) ?? release.version
    : null;
  const releaseScope = desktopClient ? instanceUrl : undefined;
  const readUnseen = useCallback(
    () => releaseId ? hasUnseenDeployedUpdate(releaseId, releaseScope) : false,
    [releaseId, releaseScope],
  );
  const unseen = useSyncExternalStore(subscribe, readUnseen, () => false);
  const markSeen = useCallback(() => {
    if (releaseId) markDeployedUpdateSeen(releaseId, releaseScope);
  }, [releaseId, releaseScope]);

  return { markSeen, release, unseen };
};
