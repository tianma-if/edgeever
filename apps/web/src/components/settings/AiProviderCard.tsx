import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiModelConfig, AiProvider, AiProviderConfig, AuthSession } from "@edgeever/shared";
import { CheckCircle2, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aiErrorMessage, isLegacyProviderDisplayName, providerDefaults, trimAiText } from "@/components/settings/ai-provider-options";
import { AiModelIdInput } from "@/components/settings/AiModelIdInput";
import {
  AiModelOutputBudgetDialog,
  hasCustomAiModelOutputBudgets,
  supportsAiModelOutputBudgets,
} from "@/components/settings/AiModelOutputBudgetDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import {
  AI_MODEL_DISCOVERY_FRESH_MS,
  modelDiscoveryStorageKey,
  nextModelDiscoveryRefresh,
  readModelDiscoveryCache,
  removeModelDiscoveryCache,
  writeModelDiscoveryCache,
} from "@/lib/ai-model-discovery-cache";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const AiProviderCard = ({ provider: saved, defaultDisplayName, defaultModelId, readOnly, onChanged }: {
  provider: AiProviderConfig;
  defaultDisplayName: string;
  defaultModelId: string | null;
  readOnly: boolean;
  onChanged: () => Promise<unknown>;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addModelDialogRef = useRef<HTMLDivElement>(null);
  const addModelTriggerRef = useRef<HTMLButtonElement>(null);
  const effectiveDisplayName = isLegacyProviderDisplayName(saved.displayName, saved.provider)
    ? defaultDisplayName
    : (saved.displayName || defaultDisplayName);
  const [provider, setProvider] = useState<AiProvider>(saved.provider);
  const [displayName, setDisplayName] = useState(effectiveDisplayName);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const [showConnection, setShowConnection] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [manualDiscovery, setManualDiscovery] = useState(false);
  const [manualDiscoveryFailed, setManualDiscoveryFailed] = useState(false);
  const [budgetModelId, setBudgetModelId] = useState<string | null>(null);
  const budgetModel = budgetModelId ? saved.models.find((model) => model.id === budgetModelId) ?? null : null;

  useEffect(() => {
    setProvider(saved.provider);
    setDisplayName(effectiveDisplayName);
    setBaseUrl(saved.baseUrl ?? "");
  }, [effectiveDisplayName, saved.baseUrl, saved.provider]);

  const userId = queryClient.getQueryData<AuthSession>(["auth", "session"])?.user?.id ?? null;
  const instanceUrl = getConfiguredDesktopApiBaseUrl() || window.location.origin;
  const storageKey = modelDiscoveryStorageKey(instanceUrl, userId, saved.id);
  const discoveryKey = ["ai-provider-models", saved.id, instanceUrl, userId, saved.provider, saved.baseUrl, discoveryRevision];
  const discoveryEnabled = !readOnly && saved.hasApiKey && !saved.credentialsUnavailable;
  const cachedDiscovery = useMemo(() => discoveryEnabled ? readModelDiscoveryCache(storageKey, saved) : undefined,
    [storageKey, saved.provider, saved.baseUrl, discoveryRevision, discoveryEnabled]);
  const discoveryQuery = useQuery({
    queryKey: discoveryKey,
    queryFn: async ({ signal }) => {
      const result = await api.discoverAiProviderModels(saved.id);
      // A cancelled request must not restore a cache cleared after a connection change.
      if (!signal.aborted) writeModelDiscoveryCache(storageKey, saved, result.models);
      return result;
    },
    initialData: cachedDiscovery ? { models: cachedDiscovery.models } : undefined,
    initialDataUpdatedAt: cachedDiscovery?.updatedAt,
    enabled: discoveryEnabled,
    staleTime: AI_MODEL_DISCOVERY_FRESH_MS,
    gcTime: AI_MODEL_DISCOVERY_FRESH_MS,
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => nextModelDiscoveryRefresh(query.state.dataUpdatedAt, query.state.errorUpdatedAt),
  });
  const discoveredModels = discoveryQuery.data?.models ?? [];
  const discoveryLoading = discoveryQuery.isFetching && (!discoveryQuery.data || manualDiscovery);
  const discoveryError = (discoveryQuery.error && !discoveryQuery.data) || manualDiscoveryFailed;
  useEffect(() => {
    if (manualDiscovery && !discoveryQuery.isFetching) {
      setManualDiscoveryFailed(Boolean(discoveryQuery.error));
      setManualDiscovery(false);
    }
    if (!discoveryQuery.error) setManualDiscoveryFailed(false);
  }, [manualDiscovery, discoveryQuery.isFetching, discoveryQuery.error]);
  const refreshModels = () => {
    setManualDiscoveryFailed(false);
    setManualDiscovery(true);
    void discoveryQuery.refetch({ cancelRefetch: false });
  };

  const saveMutation = useMutation({
    mutationFn: () => api.updateAiProvider(saved.id, {
      provider,
      displayName,
      baseUrl,
      isEnabled: saved.isEnabled,
      ...(apiKey ? { apiKey } : {}),
    }),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["ai-provider-models", saved.id] });
      queryClient.removeQueries({ queryKey: ["ai-provider-models", saved.id] });
      removeModelDiscoveryCache(storageKey);
      setDiscoveryRevision((revision) => revision + 1);
      setApiKey("");
      setShowConnection(false);
      await onChanged();
    },
  });
  const toggleMutation = useMutation({
    mutationFn: (isEnabled: boolean) => api.updateAiProvider(saved.id, {
      provider: saved.provider,
      displayName: saved.displayName,
      baseUrl: saved.baseUrl,
      isEnabled,
    }),
    onSuccess: onChanged,
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAiProvider(saved.id),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["ai-provider-models", saved.id] });
      queryClient.removeQueries({ queryKey: ["ai-provider-models", saved.id] });
      removeModelDiscoveryCache(storageKey);
      await onChanged();
    },
  });
  const testMutation = useMutation({
    mutationFn: () => api.testAiProvider(saved.id, {
      modelId: saved.models[0]?.modelId ?? "",
      provider,
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    }),
  });
  const addModelMutation = useMutation({
    mutationFn: () => {
      const nextModelId = trimAiText(modelId);
      const discovered = discoveredModels.find((item) => item.modelId === nextModelId);
      return api.addAiModel(saved.id, { modelId: nextModelId, ...(discovered ? { displayName: discovered.displayName } : {}) });
    },
    onSuccess: async () => {
      setModelId("");
      setShowAddModel(false);
      await onChanged();
    },
  });
  const deleteModelMutation = useMutation({
    mutationFn: (modelConfigId: string) => api.deleteAiModel(saved.id, modelConfigId),
    onSuccess: onChanged,
  });

  const connectionBusy = saveMutation.isPending || testMutation.isPending;
  const modelBusy = addModelMutation.isPending || deleteModelMutation.isPending;
  const cardBusy = toggleMutation.isPending || deleteMutation.isPending || modelBusy;
  const connectionDirty = provider !== saved.provider
    || trimAiText(displayName) !== trimAiText(effectiveDisplayName)
    || trimAiText(baseUrl) !== trimAiText(saved.baseUrl)
    || Boolean(apiKey);
  const connectionError = saveMutation.error ?? testMutation.error;
  const cardError = toggleMutation.error ?? deleteMutation.error ?? addModelMutation.error ?? deleteModelMutation.error;
  const handleProviderChange = (next: AiProvider) => {
    const previous = providerDefaults[provider];
    const defaults = providerDefaults[next];
    setProvider(next);
    if (!baseUrl || baseUrl === previous.baseUrl) setBaseUrl(defaults.baseUrl);
  };
  const resetConnectionForm = () => {
    setProvider(saved.provider);
    setDisplayName(effectiveDisplayName);
    setBaseUrl(saved.baseUrl ?? "");
    setApiKey("");
    saveMutation.reset();
    testMutation.reset();
  };
  const handleConnectionChange = (open: boolean) => {
    setShowConnection(open);
    if (!open) resetConnectionForm();
  };
  const openConnection = () => {
    resetConnectionForm();
    setShowConnection(true);
  };
  const handleAddModelChange = (open: boolean) => {
    setShowAddModel(open);
    if (!open) {
      setModelId("");
      setManualDiscovery(false);
      setManualDiscoveryFailed(false);
      addModelMutation.reset();
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };
  const deleteProvider = () => {
    if (window.confirm(t("aiModel.deleteProviderConfirm", { name: effectiveDisplayName }))) deleteMutation.mutate();
  };
  const deleteModel = (model: AiModelConfig) => {
    if (window.confirm(t("aiModel.deleteModelConfirm", { name: model.displayName }))) deleteModelMutation.mutate(model.id);
  };

  return (
    <section>
      <div className="flex flex-col gap-2.5 p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-xs font-normal text-slate-900">{effectiveDisplayName}</span>
            {saved.credentialsUnavailable ? (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800">
                {t("aiModel.savedCredentialsUnavailableBadge")}
              </span>
            ) : null}
            <span className="max-w-full truncate font-mono text-xs text-slate-400">
              {formatBaseUrl(saved.baseUrl)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="hidden text-xs text-slate-400 sm:inline">
              {saved.isEnabled ? t("aiModel.serviceEnabledStatus") : t("aiModel.serviceDisabledStatus")}
            </span>
            <Switch
              checked={saved.isEnabled}
              disabled={readOnly || toggleMutation.isPending}
              aria-label={t("aiModel.serviceEnabled")}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            />
            <TooltipProvider>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-500 hover:text-slate-900"
                        disabled={cardBusy}
                        aria-label={t("aiModel.serviceActions")}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("aiModel.serviceActions")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={readOnly} onSelect={openConnection}>
                    <Pencil className="mr-2 h-4 w-4" />{t("aiModel.editConnection")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-rose-600 focus:text-rose-700" disabled={readOnly} onSelect={deleteProvider}>
                    <Trash2 className="mr-2 h-4 w-4" />{t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipProvider>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">
          <TooltipProvider>
            {saved.models.length ? (
              saved.models.map((model) => (
                <span
                  key={model.id}
                  className="inline-flex h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50/80 pl-2 pr-1 text-xs text-slate-700"
                >
                  <span className="min-w-0 truncate font-normal">{model.displayName}</span>
                  {model.id === defaultModelId ? (
                    <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 text-xs font-normal text-slate-700">
                      {t("aiModel.defaultBadge")}
                    </span>
                  ) : null}
                  {supportsAiModelOutputBudgets(model) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={hasCustomAiModelOutputBudgets(model)
                            ? "h-4 w-4 shrink-0 text-slate-700 hover:bg-card hover:text-slate-900"
                            : "h-4 w-4 shrink-0 text-slate-400 hover:bg-card hover:text-slate-900"}
                          onClick={() => setBudgetModelId(model.id)}
                          aria-label={`${t(hasCustomAiModelOutputBudgets(model) ? "aiModel.outputBudgetCustomized" : "aiModel.outputBudget")}: ${model.displayName}`}
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {t(hasCustomAiModelOutputBudgets(model) ? "aiModel.outputBudgetCustomized" : "aiModel.outputBudget")}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0 text-slate-400 hover:bg-card hover:text-rose-600"
                        disabled={readOnly || deleteModelMutation.isPending}
                        onClick={() => deleteModel(model)}
                        aria-label={`${t("aiModel.removeModel")}: ${model.displayName}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t("aiModel.removeModel")}</TooltipContent>
                  </Tooltip>
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-400">{t("aiModel.noModels")}</span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6.5 w-6.5 shrink-0 text-slate-500 hover:text-slate-900"
                  disabled={readOnly}
                  ref={addModelTriggerRef}
                  onClick={() => setShowAddModel(true)}
                  aria-label={t("aiModel.addModel")}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("aiModel.addModel")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {cardError ? (
        <p className="border-t px-4 py-3 text-xs font-medium text-rose-600" role="alert">
          {aiErrorMessage(cardError, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"), t("aiModel.savedCredentialsUnavailable"))}
        </p>
      ) : null}

      <Dialog open={showConnection} onOpenChange={handleConnectionChange}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
          <form className="grid gap-5" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t("aiModel.editConnection")}</DialogTitle>
              <DialogDescription>{t("aiModel.connectionDescription", { name: effectiveDisplayName })}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aiModel.displayName")}>
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} disabled={readOnly} />
              </Field>
              <Field label={t("aiModel.provider")}>
                <Select value={provider} onValueChange={(value) => handleProviderChange(value as AiProvider)} disabled={readOnly}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai-compatible">{t("aiModel.providers.openai-compatible")}</SelectItem>
                    <SelectItem value="anthropic">{t("aiModel.providers.anthropic")}</SelectItem>
                    <SelectItem value="google">{t("aiModel.providers.google")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field label={t("aiModel.baseUrl")}>
                  <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required inputMode="url" disabled={readOnly} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label={t("aiModel.apiKey")} hint={t("aiModel.apiKeySavedHint")}>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                    placeholder={saved.hasApiKey ? t("aiModel.apiKeyStoredPlaceholder") : undefined}
                    disabled={readOnly}
                  />
                </Field>
              </div>
            </div>
            {testMutation.isSuccess ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />{t("aiModel.testSucceeded")}
              </p>
            ) : null}
            {connectionError ? (
              <p className="text-xs font-medium text-rose-600" role="alert">
                {aiErrorMessage(connectionError, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"), t("aiModel.savedCredentialsUnavailable"))}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => handleConnectionChange(false)}>{t("common.cancel")}</Button>
              <Button
                type="button"
                variant="outline"
                disabled={connectionBusy || !trimAiText(baseUrl) || (!saved.hasApiKey && !apiKey) || saved.models.length === 0}
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("aiModel.test")}
              </Button>
              <Button type="submit" variant="solid" disabled={readOnly || connectionBusy || !connectionDirty || !trimAiText(displayName) || !trimAiText(baseUrl)}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {budgetModel ? (
        <AiModelOutputBudgetDialog
          key={budgetModel.id}
          providerConfigId={saved.id}
          model={budgetModel}
          readOnly={readOnly}
          open
          onOpenChange={(open) => { if (!open) setBudgetModelId(null); }}
          onChanged={onChanged}
        />
      ) : null}

      <Dialog open={showAddModel} onOpenChange={handleAddModelChange}>
        <DialogContent
          ref={addModelDialogRef}
          onEscapeKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('[cmdk-root][data-state="open"]')) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            addModelDialogRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            addModelTriggerRef.current?.focus();
          }}
        >
          <form className="grid gap-5" onSubmit={(event: FormEvent) => { event.preventDefault(); addModelMutation.mutate(); }}>
            <DialogHeader>
              <DialogTitle>{t("aiModel.addModel")}</DialogTitle>
              <DialogDescription>{t("aiModel.addModelDescription")}</DialogDescription>
            </DialogHeader>
            <Field as="div" label={t("aiModel.modelId")} hint={discoveryLoading
              ? t("aiModel.discoveryLoading")
              : discoveryQuery.data ? t("aiModel.discoveryComplete", { count: discoveredModels.length }) : undefined}>
              <AiModelIdInput
                value={modelId}
                onValueChange={setModelId}
                models={discoveredModels}
                placeholder={t("aiModel.modelIdPlaceholder")}
              />
            </Field>
            {discoveryError || addModelMutation.error ? (
              <p className="text-xs font-medium text-rose-600" role="alert">
                {addModelMutation.error
                  ? aiErrorMessage(addModelMutation.error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"), t("aiModel.savedCredentialsUnavailable"))
                  : t("aiModel.discoveryFailed")}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:space-x-0 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={modelBusy || !discoveryEnabled || discoveryQuery.isFetching}
                onClick={refreshModels}
              >
                {discoveryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t("aiModel.refreshModels")}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => handleAddModelChange(false)}>{t("common.cancel")}</Button>
                <Button type="submit" variant="solid" disabled={readOnly || modelBusy || !trimAiText(modelId)}>
                  {addModelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("aiModel.addModel")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
};

const formatBaseUrl = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

const Field = ({ as: Comp = "label", label, hint, children }: { as?: "label" | "div"; label: string; hint?: string; children: ReactNode }) => (
  <Comp className="grid gap-1.5 text-xs font-normal leading-5 text-slate-700">
    {label}{children}{hint ? <span className="text-xs font-normal leading-4 text-slate-500">{hint}</span> : null}
  </Comp>
);
