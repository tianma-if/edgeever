import { useEffect, useRef } from "react";
import { isBrowserOffline, verifyBrowserConnectivity } from "@/lib/network-status";
import { SYNC_QUEUE_DEFERRED_EVENT } from "@/lib/sync-events";
import { createClientUuid } from "@/lib/client-id";
import {
  BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS,
  claimBackgroundRefreshLease,
  createRefreshSingleFlight,
  releaseBackgroundRefreshLease,
  type WorkspaceRefreshMode,
} from "@/lib/workspace-refresh";

type RefreshWorkspace = (mode: WorkspaceRefreshMode) => Promise<unknown>;

export const useWorkspaceSyncLifecycle = ({
  pendingSyncCount,
  backgroundRefreshKey,
  refreshWorkspace,
  runQueuedSync,
  setOnline,
  syncIntervalMs,
}: {
  pendingSyncCount: number;
  backgroundRefreshKey: string;
  refreshWorkspace: RefreshWorkspace;
  runQueuedSync: () => Promise<void>;
  setOnline: (online: boolean) => void;
  syncIntervalMs: number | null;
}) => {
  const deferredSyncTimerRef = useRef<number | null>(null);
  const deferredSyncPendingRef = useRef(false);
  const runQueuedSyncRef = useRef(runQueuedSync);
  const refreshWorkspaceRef = useRef(refreshWorkspace);
  const backgroundRefreshOwnerRef = useRef(createClientUuid());

  useEffect(() => {
    refreshWorkspaceRef.current = refreshWorkspace;
  }, [refreshWorkspace]);

  useEffect(() => {
    runQueuedSyncRef.current = runQueuedSync;
  }, [runQueuedSync]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const refreshLocalMirror = async () => {
      try {
        if (!cancelled) await refreshWorkspace("background");
      } catch {
        // Remote queries remain available if local mirror hydration fails.
      }
    };

    const scheduleRefresh = (delay: number) => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        const idleWindow = window as Window & {
          requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
          cancelIdleCallback?: (id: number) => void;
        };
        if (idleWindow.requestIdleCallback) {
          idleId = idleWindow.requestIdleCallback(() => void refreshLocalMirror(), { timeout: 2500 });
        } else {
          void refreshLocalMirror();
        }
      }, delay);
    };

    scheduleRefresh(1200);
    const handleOnline = () => scheduleRefresh(300);
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null) {
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
      }
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    let active = true;
    const updateOnlineState = async () => {
      const online = await verifyBrowserConnectivity();
      if (!active) return;
      setOnline(online);
      if (online) {
        void refreshWorkspace("manual").catch(() => {
          // Keep the local mirror available when reconnect sync fails.
        });
      }
    };

    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    void updateOnlineState();
    return () => {
      active = false;
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [refreshWorkspace, setOnline]);

  useEffect(() => {
    const handleQueueChanged = () => {
      deferredSyncPendingRef.current = false;
      if (deferredSyncTimerRef.current !== null) {
        window.clearTimeout(deferredSyncTimerRef.current);
        deferredSyncTimerRef.current = null;
      }
      void runQueuedSync();
    };
    window.addEventListener("edgeever:sync-queue-changed", handleQueueChanged);
    return () => window.removeEventListener("edgeever:sync-queue-changed", handleQueueChanged);
  }, [runQueuedSync]);

  useEffect(() => {
    const scheduleDeferredSync = () => {
      deferredSyncPendingRef.current = true;
      if (deferredSyncTimerRef.current !== null) {
        window.clearTimeout(deferredSyncTimerRef.current);
        deferredSyncTimerRef.current = null;
      }
      if (syncIntervalMs === null) return;
      deferredSyncTimerRef.current = window.setTimeout(() => {
        deferredSyncTimerRef.current = null;
        deferredSyncPendingRef.current = false;
        void runQueuedSyncRef.current();
      }, syncIntervalMs);
    };

    window.addEventListener(SYNC_QUEUE_DEFERRED_EVENT, scheduleDeferredSync);
    if (deferredSyncPendingRef.current) scheduleDeferredSync();
    return () => {
      window.removeEventListener(SYNC_QUEUE_DEFERRED_EVENT, scheduleDeferredSync);
      if (deferredSyncTimerRef.current !== null) {
        window.clearTimeout(deferredSyncTimerRef.current);
        deferredSyncTimerRef.current = null;
      }
    };
  }, [syncIntervalMs]);

  useEffect(() => {
    const leaseKey = `edgeever.background-refresh:${backgroundRefreshKey}`;
    const ownerId = backgroundRefreshOwnerRef.current;
    const runRefresh = createRefreshSingleFlight({
      refresh: () => refreshWorkspaceRef.current("background"),
    });
    const refreshVisibleWorkspace = () => {
      if (document.visibilityState === "hidden" || isBrowserOffline()) return;
      // Focus and visibility events remain immediate. Periodic refreshes use
      // a short cross-tab lease so multiple visible EdgeEver tabs do not all
      // poll D1 every thirty seconds.
      void runRefresh().catch(() => {
        // A later focus, visibility, or interval refresh will retry.
      });
    };

    const refreshLeaseOwner = () => {
      if (document.visibilityState === "hidden" || isBrowserOffline()) return;
      try {
        if (!claimBackgroundRefreshLease({ storage: window.localStorage, key: leaseKey, ownerId })) return;
      } catch {
        // Restricted storage environments still get normal single-tab sync.
      }
      refreshVisibleWorkspace();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        try {
          releaseBackgroundRefreshLease({ storage: window.localStorage, key: leaseKey, ownerId });
        } catch {
          // Ignore unavailable local storage.
        }
        return;
      }
      refreshVisibleWorkspace();
    };

    const intervalId = window.setInterval(refreshLeaseOwner, BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshVisibleWorkspace);
    window.addEventListener("pageshow", refreshVisibleWorkspace);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshVisibleWorkspace);
      window.removeEventListener("pageshow", refreshVisibleWorkspace);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      try {
        releaseBackgroundRefreshLease({ storage: window.localStorage, key: leaseKey, ownerId });
      } catch {
        // Ignore unavailable local storage.
      }
    };
  }, [backgroundRefreshKey]);

  useEffect(() => {
    if (pendingSyncCount === 0) return;
    const timer = window.setInterval(() => void runQueuedSync(), 15_000);
    return () => window.clearInterval(timer);
  }, [pendingSyncCount, runQueuedSync]);
};
