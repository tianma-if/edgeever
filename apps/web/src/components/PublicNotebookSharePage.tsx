import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "react-router";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { isSharePasswordError, PublicSharePasswordForm, PublicShareArticle } from "./PublicSharePage";
import { PublicNotebookSite } from "./PublicNotebookSite";
import { withEnvironmentTitlePrefix } from "@/lib/environment-title";
import { PUBLIC_PAGE_ROBOTS } from "@edgeever/shared/public-page-headers";

export const PublicNotebookSharePage = () => {
  const { t } = useTranslation();
  const { token: routeToken = "", memoId: routeMemoId, slug } = useParams();
  const location = useLocation();
  const identity = useQuery({
    queryKey: ["notebook-site-alias", slug],
    queryFn: () => api.resolveNotebookSite(slug!),
    enabled: Boolean(slug), retry: false, staleTime: 0, refetchOnMount: "always",
  });
  const token = slug ? (identity.isError ? "" : identity.data?.token ?? "") : routeToken;
  const directory = useQuery({
    queryKey: ["public-notebook-share", token],
    queryFn: () => api.getPublicNotebookShare(token),
    enabled: Boolean(token),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const share = directory.isError || identity.isError ? undefined : directory.data?.share;
  const memoId = routeMemoId || (new URLSearchParams(location.search).has("contents") ? undefined : share?.settings?.homeMemoId ?? undefined);
  const memo = useQuery({
    queryKey: ["public-notebook-memo", token, memoId],
    queryFn: () => api.getPublicNotebookMemo(token, memoId!),
    enabled: Boolean(memoId) && directory.isSuccess,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const note = memo.isError ? undefined : memo.data?.share;
  const access = useMemo(
    () => ({
      resourceBasePath: `/api/public/notebook-shares/${encodeURIComponent(token)}/resources`,
      memoUrls: memo.data?.memoUrls ?? {},
    }),
    [token, memo.data?.memoUrls],
  );
  useEffect(() => {
    // The server head already applies the visibility/indexing policy. Keep it
    // until the identity, directory and selected article have resolved.
    if ((slug && identity.isPending) || (token && directory.isPending) ||
      (share && memoId && (memo.isPending || memo.isFetching))) return;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = slug && share?.settings?.allowIndexing && !directory.isError && !memo.isError ? "index,follow" : PUBLIC_PAGE_ROBOTS;
    const existingRobots = [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="robots"]')];
    const existingContents = existingRobots.map((meta) => meta.content);
    existingRobots.forEach((meta) => { meta.content = robots.content; });
    document.head.appendChild(robots);
    const previous = document.title;
    document.title = withEnvironmentTitlePrefix(
      `${note?.title?.trim() || share?.name || t("sharing.notebookTitle")} · EdgeEver`,
      {
        development: import.meta.env.DEV,
        profile: __EDGEEVER_DEVELOPMENT_PROFILE__,
      },
    );
    return () => {
      robots.remove();
      existingRobots.forEach((meta, index) => { meta.content = existingContents[index]; });
      document.title = previous;
    };
  }, [note?.title, share, slug, token, memoId, identity.isPending, directory.isPending, directory.isError, memo.isPending, memo.isFetching, memo.isError, t]);
  if ((slug && identity.isPending) || (Boolean(token) && directory.isPending))
    return (
      <main className="flex min-h-[100dvh] items-center justify-center">
        <LoaderCircle
          className="h-6 w-6 animate-spin"
          aria-label={t("sharing.publicLoading")}
        />
      </main>
    );
  if (isSharePasswordError(directory.error, "share_password_required") || isSharePasswordError(memo.error, "share_password_required"))
    return <PublicSharePasswordForm
      key={token}
      token={token}
      unlock={(password) => api.unlockPublicNotebookShare(token, password)}
      onUnlocked={async () => {
        await directory.refetch();
        if (memoId) await memo.refetch();
      }}
    />;
  if (!share)
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">
          {t("sharing.notebookUnavailable")}
        </h1>
        <p>{t("sharing.notebookUnavailableHint")}</p>
        <Button variant="outline" onClick={() => void (slug && identity.isError ? identity.refetch() : directory.refetch())}>
          {t("sharing.retry")}
        </Button>
      </main>
    );
  return (
    <PublicNotebookSite
      key={token}
      share={share}
      token={token}
      selectedId={memoId}
    >
      {memoId &&
        (memo.isPending ? (
          <div className="flex min-h-60 items-center justify-center">
            <LoaderCircle
              className="h-6 w-6 animate-spin"
              aria-label={t("sharing.publicLoading")}
            />
          </div>
        ) : note && share.memos.some((item) => item.id === memoId) ? (
          <PublicShareArticle
            key={memoId}
            share={note}
            token={token}
            access={access}
            layout="site"
          />
        ) : (
          <section className="mx-auto max-w-4xl space-y-4 px-5 py-12 sm:px-10">
            <h1 className="text-xl font-semibold">
              {t("sharing.publicUnavailable")}
            </h1>
            <p className="text-slate-500">
              {t("sharing.notebookNoteUnavailableHint")}
            </p>
            <Button variant="outline" onClick={() => void memo.refetch()}>
              {t("sharing.retry")}
            </Button>
          </section>
        ))}
    </PublicNotebookSite>
  );
};
