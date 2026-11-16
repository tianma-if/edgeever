import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
  SETTINGS_ITEM_TITLE_CLASSNAME,
} from "./settings-ui";
import { copyTextToClipboard, getEdgeEverBaseUrl } from "./settings-utils";

const parseCommaSeparated = (raw: string): string[] =>
  raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const NotionSyncCard = ({
  demoMode,
  refreshWorkspaceAfterSync,
}: {
  demoMode: boolean;
  refreshWorkspaceAfterSync?: () => Promise<unknown> | void;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  const [isEnabled, setIsEnabled] = useState(true);
  const [apiToken, setApiToken] = useState("");
  const [databaseId, setDatabaseId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [tagFilterText, setTagFilterText] = useState("");
  const [notebookFilterText, setNotebookFilterText] = useState("");

  const [copiedTarget, setCopiedTarget] = useState<"url" | "token" | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [syncProcessedCount, setSyncProcessedCount] = useState<number | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["notion-sync-settings"],
    queryFn: api.getNotionSyncSettings,
    enabled: !demoMode,
    refetchInterval: (query) => {
      const data = query.state.data?.settings;
      return open && data?.configured && !data.hasWebhookSecret ? 4000 : false;
    },
  });

  const settings = settingsQuery.data?.settings;

  useEffect(() => {
    if (!settings) return;
    setIsEnabled(settings.configured ? settings.isEnabled : true);
    setDatabaseId(settings.databaseId ?? "");
    setTagFilterText(settings.tagFilter.join(", "));
    setNotebookFilterText(settings.notebookFilter.join(", "));
  }, [settings]);

  const handleCopy = async (value: string, target: "url" | "token") => {
    if (!(await copyTextToClipboard(value))) return;
    setCopiedTarget(target);
    window.setTimeout(() => setCopiedTarget((prev) => (prev === target ? null : prev)), 1600);
  };

  const testMutation = useMutation({
    mutationFn: () =>
      api.testNotionSyncConnection({
        databaseId,
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
      }),
    onSuccess: (res) => {
      setDatabaseId(res.databaseId);
      setFeedbackMessage({
        kind: "success",
        text: t("notionSync.testSuccess", { title: res.databaseTitle }),
      });
    },
    onError: (err) => {
      setFeedbackMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateNotionSyncSettings({
        isEnabled,
        databaseId,
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        tagFilter: parseCommaSeparated(tagFilterText),
        notebookFilter: parseCommaSeparated(notebookFilterText),
      }),
    onSuccess: async (res) => {
      setApiToken("");
      setWebhookSecret("");
      setDatabaseId(res.settings.databaseId);
      setFeedbackMessage({ kind: "success", text: t("notionSync.saved") });
      await queryClient.invalidateQueries({ queryKey: ["notion-sync-settings"] });
    },
    onError: (err) => {
      setFeedbackMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.rotateNotionSyncWebhook(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notion-sync-settings"] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.deleteNotionSyncSettings(),
    onSuccess: async () => {
      setConfirmDisconnectOpen(false);
      setApiToken("");
      setDatabaseId("");
      setWebhookSecret("");
      setFeedbackMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["notion-sync-settings"] });
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      let phase: "ee_to_notion" | "notion_to_ee" | undefined = "ee_to_notion";
      let cursor: string | null | undefined = null;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let processed = 0;
      setSyncProcessedCount(0);

      for (let step = 0; step < 200; step += 1) {
        const res = await api.runNotionSyncBatch({ phase, cursor });
        created += res.summary.created;
        updated += res.summary.updated;
        skipped += res.summary.skipped;
        processed +=
          res.summary.created + res.summary.updated + res.summary.archived + res.summary.skipped;
        setSyncProcessedCount(processed);

        if (!res.hasMore || !res.nextPhase) {
          break;
        }
        phase = res.nextPhase;
        cursor = res.nextCursor;
      }

      return { created, updated, skipped };
    },
    onSuccess: async (totals) => {
      setSyncProcessedCount(null);
      setFeedbackMessage({
        kind: "success",
        text: t("notionSync.syncComplete", totals),
      });
      await queryClient.invalidateQueries({ queryKey: ["notion-sync-settings"] });
      await refreshWorkspaceAfterSync?.();
    },
    onError: (err) => {
      setSyncProcessedCount(null);
      setFeedbackMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFeedbackMessage(null);
    saveMutation.mutate();
  };

  const fullWebhookUrl = settings?.webhookPath
    ? `${getEdgeEverBaseUrl()}${settings.webhookPath}`
    : "";

  const statusBadge = !settings?.configured
    ? { label: t("notionSync.notConfigured"), variant: "secondary" as const }
    : settings.isEnabled
      ? { label: t("notionSync.enabled"), variant: "default" as const }
      : { label: t("notionSync.disabled"), variant: "outline" as const };

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="w-full min-w-0 shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                  <ArrowLeftRight className={SETTINGS_CARD_ICON_CLASSNAME} />
                  {t("notionSync.title")}
                </CardTitle>
                <Badge variant={statusBadge.variant} className="text-[11px] font-normal">
                  {statusBadge.label}
                </Badge>
                {settings?.databaseTitle ? (
                  <span className="truncate rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {settings.databaseTitle}
                  </span>
                ) : null}
              </div>
              <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
                {t("notionSync.description")}
              </CardDescription>
              {settings?.lastSyncedAt ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("notionSync.lastSynced", { time: formatDateTime(settings.lastSyncedAt) })}
                </p>
              ) : null}
              {settings?.lastError ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  <span className="truncate">{settings.lastError}</span>
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {settings?.configured && !demoMode ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={syncAllMutation.isPending}
                  onClick={() => {
                    setFeedbackMessage(null);
                    syncAllMutation.mutate();
                  }}
                >
                  {syncAllMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {syncAllMutation.isPending
                    ? t("notionSync.syncing", { count: syncProcessedCount ?? 0 })
                    : t("notionSync.syncNow")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={demoMode}
                onClick={() => {
                  setFeedbackMessage(null);
                  setOpen(true);
                }}
              >
                {t("notionSync.configure")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>{t("notionSync.title")}</DialogTitle>
              <DialogDescription>{t("notionSync.description")}</DialogDescription>
            </DialogHeader>

            {settings && !settings.encryptionConfigured ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {t("notionSync.encryptionUnavailable")}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                    {t("notionSync.enabledLabel")}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("notionSync.enabledHint")}
                  </p>
                </div>
                <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
              </div>

              <div className="space-y-1.5">
                <label className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                  {t("notionSync.apiTokenLabel")}
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={
                    settings?.hasApiToken
                      ? t("notionSync.apiTokenSavedPlaceholder")
                      : t("notionSync.apiTokenPlaceholder")
                  }
                />
              </div>

              <div className="space-y-1.5">
                <label className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                  {t("notionSync.databaseIdLabel")}
                </label>
                <Input
                  value={databaseId}
                  onChange={(e) => setDatabaseId(e.target.value)}
                  placeholder={t("notionSync.databaseIdPlaceholder")}
                />
              </div>

              {fullWebhookUrl ? (
                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                      {t("notionSync.webhookUrlLabel")}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={rotateMutation.isPending}
                            onClick={() => rotateMutation.mutate()}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("notionSync.rotateWebhook")}</TooltipContent>
                      </Tooltip>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => void handleCopy(fullWebhookUrl, "url")}
                      >
                        <Copy className="size-3" />
                        {copiedTarget === "url" ? t("notionSync.copied") : t("notionSync.copy")}
                      </Button>
                    </div>
                  </div>
                  <p className="break-all rounded border bg-background px-2.5 py-1.5 font-mono text-xs">
                    {fullWebhookUrl}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("notionSync.webhookUrlHint")}
                  </p>

                  {settings?.pendingVerificationToken ? (
                    <div className="mt-2 space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                        {t("notionSync.pendingTokenBanner")}
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
                          {settings.pendingVerificationToken}
                        </code>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2.5 text-xs"
                          onClick={() =>
                            void handleCopy(settings.pendingVerificationToken!, "token")
                          }
                        >
                          <Copy className="size-3" />
                          {copiedTarget === "token"
                            ? t("notionSync.copied")
                            : t("notionSync.copy")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                  {t("notionSync.webhookSecretLabel")}
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={
                    settings?.hasWebhookSecret
                      ? t("notionSync.webhookSecretSavedPlaceholder")
                      : t("notionSync.webhookSecretPlaceholder")
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                    {t("notionSync.tagFilterLabel")}
                  </label>
                  <Input
                    value={tagFilterText}
                    onChange={(e) => setTagFilterText(e.target.value)}
                    placeholder={t("notionSync.tagFilterPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={SETTINGS_ITEM_TITLE_CLASSNAME}>
                    {t("notionSync.notebookFilterLabel")}
                  </label>
                  <Input
                    value={notebookFilterText}
                    onChange={(e) => setNotebookFilterText(e.target.value)}
                    placeholder={t("notionSync.notebookFilterPlaceholder")}
                  />
                </div>
              </div>

              {feedbackMessage ? (
                <div
                  className={
                    feedbackMessage.kind === "success"
                      ? "flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                      : "flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  }
                >
                  {feedbackMessage.kind === "success" ? (
                    <CheckCircle2 className="size-3.5 shrink-0" />
                  ) : (
                    <TriangleAlert className="size-3.5 shrink-0" />
                  )}
                  <span>{feedbackMessage.text}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <div>
                  {settings?.configured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setConfirmDisconnectOpen(true)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("notionSync.disconnect")}
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!databaseId.trim() || testMutation.isPending}
                    onClick={() => {
                      setFeedbackMessage(null);
                      testMutation.mutate();
                    }}
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    {testMutation.isPending
                      ? t("notionSync.testing")
                      : t("notionSync.testConnection")}
                  </Button>

                  {settings?.configured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={syncAllMutation.isPending}
                      onClick={() => {
                        setFeedbackMessage(null);
                        syncAllMutation.mutate();
                      }}
                    >
                      {syncAllMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {syncAllMutation.isPending
                        ? t("notionSync.syncing", { count: syncProcessedCount ?? 0 })
                        : t("notionSync.syncNow")}
                    </Button>
                  ) : null}

                  <Button
                    type="submit"
                    size="sm"
                    variant="solid"
                    disabled={
                      !databaseId.trim()
                      || (!settings?.hasApiToken && !apiToken.trim())
                      || saveMutation.isPending
                    }
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    {saveMutation.isPending ? t("notionSync.saving") : t("notionSync.save")}
                  </Button>
                </div>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {confirmDisconnectOpen ? (
          <AppConfirmDialog
            title={t("notionSync.disconnect")}
            description={t("notionSync.disconnectConfirm")}
            confirmLabel={t("notionSync.disconnect")}
            cancelLabel={t("notionSync.close")}
            tone="danger"
            isWorking={disconnectMutation.isPending}
            onCancel={() => setConfirmDisconnectOpen(false)}
            onConfirm={() => disconnectMutation.mutate()}
          />
        ) : null}
      </Card>
    </TooltipProvider>
  );
};
