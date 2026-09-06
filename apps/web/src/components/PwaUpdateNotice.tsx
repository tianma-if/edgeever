import { useEffect, useMemo, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PWA_UPDATE_NOTICE_EVENT,
  type PwaUpdateNoticeEvent,
  type PwaUpdateNoticeKind,
} from "@/lib/pwa-update-notice";

type Notice = {
  id: number;
  kind: PwaUpdateNoticeKind;
};

const isStandaloneApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const isDesktopViewport = () => window.matchMedia("(min-width: 1024px)").matches;

const getDisplayMode = () => {
  const isStandalone = isStandaloneApp();

  return {
    isDesktop: isDesktopViewport(),
    visible: isStandalone,
  };
};

const watchDisplayMode = (onChange: () => void) => {
  const mediaQueries = [
    window.matchMedia("(display-mode: standalone)"),
    window.matchMedia("(display-mode: fullscreen)"),
    window.matchMedia("(min-width: 1024px)"),
  ];

  for (const query of mediaQueries) {
    query.addEventListener("change", onChange);
  }

  return () => {
    for (const query of mediaQueries) {
      query.removeEventListener("change", onChange);
    }
  };
};

export const PwaUpdateNotice = () => {
  const { t } = useTranslation();
  const [displayMode, setDisplayMode] = useState(() => getDisplayMode());
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const syncDisplayMode = () => setDisplayMode(getDisplayMode());
    return watchDisplayMode(syncDisplayMode);
  }, []);

  useEffect(() => {
    if (!displayMode.visible) {
      return;
    }

    const handleNotice = (event: Event) => {
      const { kind } = (event as PwaUpdateNoticeEvent).detail;
      setNotice({ id: Date.now(), kind });
    };

    window.addEventListener(PWA_UPDATE_NOTICE_EVENT, handleNotice);
    return () => window.removeEventListener(PWA_UPDATE_NOTICE_EVENT, handleNotice);
  }, [displayMode.visible]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 8_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const noticeCopy = useMemo<Record<PwaUpdateNoticeKind, { title: string; description: string }>>(
    () => ({
      checking: {
        title: t("pwa.checkingTitle"),
        description: t("pwa.checkingDescription"),
      },
      "reload-required": {
        title: t("pwa.readyTitle"),
        description: t("pwa.readyDescription"),
      },
    }),
    [t]
  );

  const copy = useMemo(() => (notice ? noticeCopy[notice.kind] : null), [notice, noticeCopy]);

  if (!displayMode.visible || !notice || !copy) {
    return null;
  }

  const isReloadRequired = notice.kind === "reload-required";

  return (
    <div
      className={cn(
        "fixed z-[80] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white/95 p-3 text-slate-900 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur",
        displayMode.isDesktop
          ? "right-5 top-5 w-[22rem]"
          : "inset-x-4 bottom-[calc(4rem+env(safe-area-inset-bottom))]"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600" aria-hidden="true">
          <RefreshCw className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-5">{copy.title}</div>
          <div className="mt-0.5 text-xs leading-5 text-slate-500">{copy.description}</div>
          {isReloadRequired ? (
            <Button className="mt-2" size="sm" variant="solid" onClick={() => window.location.reload()}>
              {t("pwa.refreshNow")}
            </Button>
          ) : null}
        </div>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          type="button"
          aria-label={t("pwa.closeNotice")}
          onClick={() => setNotice(null)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
