import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Settings2, Share2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SharePasswordControls } from "./SharePasswordControls";
import { ShareQrCode } from "./ShareQrCode";
import { SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME, SHARE_DIALOG_WIDTH_CLASS_NAME } from "./share-dialog-layout";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NotebookSiteSettings } from "../NotebookSiteSettings";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";

export const getPublicNotebookShareUrl = (token: string, slug?: string | null) =>
  `${(getConfiguredDesktopApiBaseUrl() || window.location.origin).replace(/\/$/, "")}${slug ? `/s/${encodeURIComponent(slug)}` : `/share/notebook/${encodeURIComponent(token)}`}`;

export const ShareNotebookDialog = ({
  notebookId,
  notebookName,
  inherited = false,
  open,
  onOpenChange,
}: {
  notebookId: string;
  notebookName: string;
  inherited?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyResetTimerRef = useRef<number | null>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);

  const queryKey = [
    "notebook-share",
    getConfiguredDesktopApiBaseUrl(),
    notebookId,
  ];

  const query = useQuery({
    queryKey,
    queryFn: () => api.getNotebookShare(notebookId),
    enabled: open,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["notebook-shares"] });

  const create = useMutation({
    mutationFn: () => api.createNotebookShare(notebookId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void invalidate();
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (passwordProtected: boolean) => api.updateNotebookShare(notebookId, { passwordProtected }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void invalidate();

    },
  });

  const revoke = useMutation({
    mutationFn: () => api.revokeNotebookShare(notebookId),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { share: null });
      setCopyState("idle");
      void invalidate();
    },
  });

  useEffect(() => {
    create.reset();
    passwordMutation.reset();
    revoke.reset();
    setCopyState("idle");
  }, [notebookId]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const share = query.data?.share ?? null;

  const revealedPassword = share?.passwordProtected ? share.password ?? "" : "";

  const shareUrl = share ? getPublicNotebookShareUrl(share.token, share.siteSlug) : "";
  const sitePath = `/notebooks/${encodeURIComponent(notebookId)}/site`;
  const busy = query.isFetching || create.isPending || revoke.isPending || passwordMutation.isPending;
  const failed = query.isError || create.isError || revoke.isError || passwordMutation.isError;
  const hasPassword = Boolean(share?.passwordProtected && revealedPassword);

  const handlePrimaryCopy = async () => {
    const value = hasPassword
      ? `${shareUrl}\n${t("sharing.passwordPrefix")}${revealedPassword}`
      : shareUrl;
    const ok = await copyTextToClipboard(value);
    setCopyState(ok ? "copied" : "error");
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 3000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className={`${SHARE_DIALOG_WIDTH_CLASS_NAME} max-h-[90dvh] overflow-y-auto space-y-4`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialogContentRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Share2 className="h-5 w-5 text-slate-700" />
            {t("sharing.notebookTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-slate-500">
            <span className="font-medium text-slate-800">{notebookName}</span>
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div className="flex min-h-20 items-center justify-center text-slate-500" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-label={t("sharing.publicLoading")} />
          </div>
        ) : share ? (
          <div className="space-y-3.5">
            <p className="text-xs leading-5 text-slate-600">
              {t(share.passwordProtected ? "sharing.notebookProtectedScopeHint" : "sharing.notebookScopeHint")}
            </p>
            {inherited ? (
              <p className="text-xs leading-5 text-slate-600">{t("sharing.notebookInheritedHint")}</p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={shareUrl}
                readOnly
                aria-label={t("sharing.linkLabel")}
                className="min-w-0 font-mono text-xs"
              />
              <Button
                variant={copyState === "copied" ? "solid" : copyState === "error" ? "danger" : "outline"}
                className={`min-w-28 shrink-0 self-end sm:self-auto ${copyState === "copied" ? SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME : ""}`}
                aria-live="polite"
                onClick={() => void handlePrimaryCopy()}
              >
                {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {t(
                  copyState === "copied"
                    ? "sharing.copied"
                    : copyState === "error"
                      ? "sharing.copyFailed"
                      : hasPassword
                        ? "sharing.copyLinkAndPassword"
                        : "sharing.copy",
                )}
              </Button>
            </div>

            <SharePasswordControls
              key={share.token}
              passwordProtected={share.passwordProtected}
              password={revealedPassword}
              busy={busy}
              shareUrl={shareUrl}
              hideCopyBoth={true}
              onChange={(enabled) => passwordMutation.mutate(enabled)}
            />

            {share.passwordProtected ? null : (
              <ShareQrCode key={`qr-${share.token}`} url={shareUrl} hint={t("sharing.qrCodeNotebookHint")} />
            )}
            {location.pathname !== sitePath && <Collapsible key={`site-settings-${share.token}`}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" className="group w-full justify-between">
                  <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />{t("notebookSite.advancedSettings")}</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent forceMount className="pt-4 data-[state=closed]:hidden">
                <NotebookSiteSettings
                  key={`${share.token}-${share.passwordProtected}`}
                  notebookId={notebookId}
                  share={share}
                  onSaved={(data) => { queryClient.setQueryData(queryKey, data); void invalidate(); }}
                />
              </CollapsibleContent>
            </Collapsible>}

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => revoke.mutate()}
              >
                <Trash2 className="h-4 w-4" />
                {t("sharing.revoke")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  window.open(shareUrl, "_blank", "noopener,noreferrer")
                }
              >
                <ExternalLink className="h-4 w-4" />
                {t("sharing.open")}
              </Button>
            </div>
          </div>
        ) : !query.isError ? (
          <div className="space-y-3">
            <p className="text-xs leading-6 text-slate-600">{t(inherited ? "sharing.notebookInheritedOnlyHint" : "sharing.notebookScopeHint")}</p>
            <Button className={`w-full ${SHARE_DIALOG_PRIMARY_BUTTON_CLASS_NAME}`} variant="solid" disabled={busy} onClick={() => create.mutate()}>
              {create.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              {t(inherited ? "sharing.notebookCreateIndependent" : "sharing.create")}
            </Button>
          </div>
        ) : null}

        {failed ? (
          <div role="alert" className="space-y-2 text-sm text-rose-600">
            <p>{t("sharing.error")}</p>
            {query.isError ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void query.refetch()}
              >
                {t("sharing.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}

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
