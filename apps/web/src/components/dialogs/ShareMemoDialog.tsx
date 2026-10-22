import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, LoaderCircle, Share2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SharePasswordControls } from "./SharePasswordControls";
import { ShareQrCode } from "./ShareQrCode";
import { SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME, SHARE_DIALOG_WIDTH_CLASS_NAME } from "./share-dialog-layout";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { MemoNotebookSites } from "../MemoNotebookSites";

export const getPublicShareUrl = (token: string) => {
  const baseUrl = getConfiguredDesktopApiBaseUrl() || window.location.origin;
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
  const { t } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [copyTarget, setCopyTarget] = useState<"link" | "password" | "both">("link");
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
    mutationFn: (passwordProtected: boolean) => api.updateMemoShare(memoId, { passwordProtected }),
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
    revokeMutation.reset();
    setCopyState("idle");
    setCopyTarget("link");
  }, [memoId, open]);
  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const share = shareQuery.data?.share ?? null;
  const revealedPassword = share?.passwordProtected ? share.password ?? "" : "";

  const shareUrl = share ? getPublicShareUrl(share.token) : "";
  const isWorking = shareQuery.isLoading || createMutation.isPending || passwordMutation.isPending || revokeMutation.isPending;
  const error = shareQuery.error || createMutation.error || passwordMutation.error || revokeMutation.error;

  const markCopied = (target: "link" | "password" | "both", copied: boolean) => {
    setCopyTarget(target);
    setCopyState(copied ? "copied" : "error");
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 3000);
  };

  const copyValue = async (target: "link" | "password" | "both", value: string) => {
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

            <SharePasswordControls
              passwordProtected={share.passwordProtected}
              password={revealedPassword}
              busy={isWorking}
              shareUrl={shareUrl}
              hideCopyBoth={true}
              onChange={(enabled) => passwordMutation.mutate(enabled)}
            />

            {share.passwordProtected ? null : (
              <ShareQrCode key={`qr-${share.token}`} url={shareUrl} hint={t("sharing.qrCodeHint")} />
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="danger" disabled={isWorking} onClick={() => revokeMutation.mutate(memoId, { onSuccess: () => onOpenChange(false) })}>
                <Trash2 className="h-4 w-4" />
                {t("sharing.revoke")}
              </Button>
              <Button variant="outline" onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-4 w-4" />
                {t("sharing.open")}
              </Button>
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
