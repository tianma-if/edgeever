import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Eye, FileCode2, Globe, LoaderCircle, Share2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { memoSharePathSegment } from "@edgeever/shared";
import { ShareExpiryControls } from "./ShareExpiryControls";
import { SharePasswordControls } from "./SharePasswordControls";
import { ShareSlugControls } from "./ShareSlugControls";
import { ShareQrCode } from "./ShareQrCode";
import { SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME, SHARE_DIALOG_WIDTH_CLASS_NAME } from "./share-dialog-layout";
import { api, ApiRequestError, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { MemoNotebookSites } from "../MemoNotebookSites";

export const getPublicShareUrl = (token: string) => {
  const baseUrl = getConfiguredDesktopApiBaseUrl() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${baseUrl.replace(/\/$/, "")}/share/${encodeURIComponent(token)}`;
};

export const memoShareQueryKey = (memoId: string) => ["memo-share", memoId] as const;

export const ShareMemoDialog = ({
  memoId,
  open,
  onOpenChange,
}: {
  memoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [copyTarget, setCopyTarget] = useState<"link" | "password" | "both" | "markdown">("link");
  const copyResetTimerRef = useRef<number | null>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const queryKey = memoShareQueryKey(memoId);
  const shareQuery = useQuery({
    queryKey,
    queryFn: () => api.getMemoShare(memoId),
    enabled: open,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
  });
  const createMutation = useMutation({
    mutationFn: () => api.createMemoShare(memoId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  const passwordMutation = useMutation({
    mutationFn: ({ passwordProtected, password }: { passwordProtected: boolean; password?: string }) =>
      api.updateMemoShare(memoId, { passwordProtected, ...(password ? { password } : {}) }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  const presentationMutation = useMutation({
    mutationFn: (settings: { showUpdatedAt?: boolean; showBranding?: boolean }) => api.updateMemoShare(memoId, settings),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  const slugMutation = useMutation({
    mutationFn: (slug: string | null) => api.updateMemoShare(memoId, { slug }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  const expiryMutation = useMutation({
    mutationFn: (expiresAt: string | null) => api.updateMemoShare(memoId, { expiresAt }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (targetMemoId: string) => api.revokeMemoShare(targetMemoId),
    onSuccess: (_, targetMemoId) => {
      queryClient.setQueryData(memoShareQueryKey(targetMemoId), { share: null });
      void queryClient.invalidateQueries({ queryKey: ["memo-shares"] });
    },
  });
  useEffect(() => {
    createMutation.reset();
    passwordMutation.reset();
    presentationMutation.reset();
    slugMutation.reset();
    expiryMutation.reset();
    revokeMutation.reset();
    setCopyState("idle");
    setCopyTarget("link");
  }, [memoId, open]);
  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const share = shareQuery.data?.share ?? null;
  const revealedPassword = share?.passwordProtected ? share.password ?? "" : "";

  const shareUrl = share ? getPublicShareUrl(memoSharePathSegment(share)) : "";
  const markdownUrl = shareUrl ? `${shareUrl}.md` : "";
  const isWorking = shareQuery.isLoading || createMutation.isPending || passwordMutation.isPending || presentationMutation.isPending || slugMutation.isPending || expiryMutation.isPending || revokeMutation.isPending;
  const slugTaken = slugMutation.error instanceof ApiRequestError && slugMutation.error.code === "share_slug_taken";
  const expiryInvalid = expiryMutation.error instanceof ApiRequestError && expiryMutation.error.code === "share_expiry_invalid";
  const error = shareQuery.error || createMutation.error || passwordMutation.error || presentationMutation.error || (slugTaken ? null : slugMutation.error) || (expiryInvalid ? null : expiryMutation.error) || revokeMutation.error;
  const formatViewedAt = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  const markCopied = (target: "link" | "password" | "both" | "markdown", copied: boolean) => {
    setCopyTarget(target);
    setCopyState(copied ? "copied" : "error");
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 3000);
  };

  const copyValue = async (target: "link" | "password" | "both" | "markdown", value: string) => {
    markCopied(target, await copyTextToClipboard(value));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        aria-describedby={undefined}
        className={`${SHARE_DIALOG_WIDTH_CLASS_NAME} max-h-[85dvh] space-y-4 overflow-y-auto`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialogContentRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {share ? <Globe className="h-5 w-5 text-slate-700" /> : <Share2 className="h-5 w-5 text-slate-700" />}
            {t(share ? "sharing.manage" : "sharing.title")}
          </DialogTitle>
        </DialogHeader>

        <MemoNotebookSites key={memoId} memoId={memoId} />
        <h2 className="text-sm font-semibold">{t("sharing.individual")}</h2>
        {shareQuery.isLoading ? (
          <div className="flex min-h-20 items-center justify-center text-slate-500" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-label={t("sharing.publicLoading")} />
          </div>
        ) : share ? (
          <div className="space-y-3.5">
            {/* SharePasswordControls renders t("sharing.passwordToggle") */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={shareUrl} readOnly aria-label={t("sharing.linkLabel")} className="min-w-0 font-mono text-xs" />
              <Button
                variant={copyState === "copied" && copyTarget === "link" ? "solid" : copyState === "error" && copyTarget === "link" ? "danger" : "outline"}
                className={`min-w-28 shrink-0 self-end sm:self-auto ${copyState === "copied" && copyTarget === "link" ? SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME : ""}`}
                aria-live="polite"
                onClick={() =>
                  void copyValue(
                    "link",
                    share.passwordProtected && revealedPassword
                      ? `${shareUrl}\n${t("sharing.passwordPrefix")}${revealedPassword}`
                      : shareUrl,
                  )
                }
              >
                {copyState === "copied" && copyTarget === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {t(
                  copyState === "copied" && copyTarget === "link"
                    ? "sharing.copied"
                    : copyState === "error" && copyTarget === "link"
                      ? "sharing.copyFailed"
                      : share.passwordProtected && revealedPassword
                        ? "sharing.copyLinkAndPassword"
                        : "sharing.copy",
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2 px-0.5 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-slate-700 dark:text-slate-300">
                <FileCode2 className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="font-medium">{t("sharing.markdownRawLabel")}</span>
                <span className="truncate text-[11px] text-slate-400">
                  · {share.passwordProtected
                    ? t("sharing.markdownPasswordProtectedHint")
                    : t("sharing.markdownHint")}
                </span>
              </span>
              <Button
                type="button"
                variant={copyState === "copied" && copyTarget === "markdown" ? "solid" : copyState === "error" && copyTarget === "markdown" ? "danger" : "outline"}
                size="sm"
                className={`h-7 px-2.5 text-xs shrink-0 ${copyState === "copied" && copyTarget === "markdown" ? SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME : ""}`}
                disabled={Boolean(share.passwordProtected)}
                onClick={() => void copyValue("markdown", markdownUrl)}
              >
                {copyState === "copied" && copyTarget === "markdown" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {t(
                  copyState === "copied" && copyTarget === "markdown"
                    ? "sharing.copied"
                    : copyState === "error" && copyTarget === "markdown"
                      ? "sharing.copyFailed"
                      : "sharing.copyMarkdownLink",
                )}
              </Button>
            </div>

            <ShareSlugControls
              slug={share.slug ?? null}
              busy={isWorking}
              taken={slugTaken}
              onChange={(slug) => slugMutation.mutate(slug)}
            />

            <SharePasswordControls
              passwordProtected={share.passwordProtected}
              password={revealedPassword}
              busy={isWorking}
              shareUrl={shareUrl}
              hideCopyBoth={true}
              allowCustomPassword={true}
              onChange={(enabled, password) => {
                const payload = { passwordProtected: enabled, password };
                if (password !== undefined) {
                  return passwordMutation.mutateAsync(payload).then(() => undefined);
                }
                passwordMutation.mutate(payload);
              }}
            />

            <ShareExpiryControls
              expiresAt={share.expiresAt ?? null}
              expired={share.expired === true}
              busy={isWorking}
              invalid={expiryInvalid}
              onChange={(expiresAt) => expiryMutation.mutate(expiresAt)}
            />

            {share.viewCount !== undefined ? (
              <p className="flex items-center gap-1.5 text-xs leading-5 text-slate-500">
                <Eye className="h-3.5 w-3.5 shrink-0" />
                {share.viewCount > 0
                  ? [
                      t("sharing.viewsCount", { count: share.viewCount }),
                      share.lastViewedAt ? t("sharing.viewsLast", { date: formatViewedAt(share.lastViewedAt) }) : null,
                    ].filter(Boolean).join(" · ")
                  : t("sharing.viewsNone")}
              </p>
            ) : null}

            <div className="space-y-3 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="share-show-updated-at" className="text-xs font-normal leading-5 text-slate-600">{t("sharing.showUpdatedAt")}</label>
                <Switch
                  id="share-show-updated-at"
                  aria-label={t("sharing.showUpdatedAt")}
                  checked={share.showUpdatedAt !== false}
                  disabled={isWorking}
                  onCheckedChange={(enabled) => presentationMutation.mutate({ showUpdatedAt: enabled })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="share-show-branding" className="text-xs font-normal leading-5 text-slate-600">{t("sharing.showBranding")}</label>
                <Switch
                  id="share-show-branding"
                  aria-label={t("sharing.showBranding")}
                  checked={share.showBranding !== false}
                  disabled={isWorking}
                  onCheckedChange={(enabled) => presentationMutation.mutate({ showBranding: enabled })}
                />
              </div>
            </div>

            {share.passwordProtected ? null : (
              <ShareQrCode key={`qr-${share.token}`} url={shareUrl} hint={t("sharing.qrCodeHint")} />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Button variant="danger" disabled={isWorking} onClick={() => revokeMutation.mutate(memoId, { onSuccess: () => onOpenChange(false) })}>
                <Trash2 className="h-4 w-4" />
                {t("sharing.revoke")}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                {!share.passwordProtected ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => window.open(markdownUrl, "_blank", "noopener,noreferrer")}
                  >
                    <FileCode2 className="h-4 w-4" />
                    {t("sharing.openMarkdown")}
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" />
                  {t("sharing.open")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            className={`w-full ${SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}`}
            variant="solid"
            disabled={isWorking}
            onClick={() => {
              if (shareQuery.isError) void shareQuery.refetch();
              else createMutation.mutate();
            }}
          >
            {createMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {t(shareQuery.isError ? "sharing.retry" : "sharing.createIndividual")}
          </Button>
        )}
        {error ? <p className="text-xs leading-5 text-rose-600" role="alert">{t("sharing.error")}</p> : null}

        {location.pathname !== "/settings" ? (
          <div className="pt-1 text-center">
            <Link
              to="/settings?tab=sharing"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {t("sharing.viewAll")}
            </Link>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
