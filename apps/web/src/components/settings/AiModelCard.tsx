import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiProvider } from "@edgeever/shared";
import { ChevronDown, Loader2, Plus, Server, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiProviderCard } from "@/components/settings/AiProviderCard";
import {
  aiErrorMessage,
  formatProviderOrdinal,
  isLegacyProviderDisplayName,
  providerDefaults,
} from "@/components/settings/ai-provider-options";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import {
  readAiStreamingPreference,
  writeAiStreamingPreference,
} from "@/lib/ai-generation-preference";
import { cn } from "@/lib/utils";

export const AiModelCard = () => {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const settingsQuery = useQuery({
    queryKey: ["ai-settings", locale],
    queryFn: () => api.getAiSettings(locale),
  });
  const [expanded, setExpanded] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState<AiProvider>("openai-compatible");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState(providerDefaults["openai-compatible"].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [initialModelId, setInitialModelId] = useState(providerDefaults["openai-compatible"].modelId);
  const [streamingEnabled, setStreamingEnabled] = useState(readAiStreamingPreference);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
  const resetAddForm = (nextDisplayName = "") => {
    setProvider("openai-compatible");
    setDisplayName(nextDisplayName);
    setBaseUrl(providerDefaults["openai-compatible"].baseUrl);
    setInitialModelId(providerDefaults["openai-compatible"].modelId);
    setApiKey("");
    createMutation.reset();
  };
  const createMutation = useMutation({
    mutationFn: () => api.createAiProvider({
      provider,
      displayName,
      baseUrl,
      apiKey,
      isEnabled: true,
      ...(initialModelId.trim() ? { initialModelId: initialModelId.trim() } : {}),
    }),
    onSuccess: async () => {
      setShowAdd(false);
      setApiKey("");
      await refresh();
    },
  });
  const defaultMutation = useMutation({
    mutationFn: api.updateDefaultAiModel,
    onSuccess: refresh,
  });

  const handleProviderChange = (next: AiProvider) => {
    const previous = providerDefaults[provider];
    const defaults = providerDefaults[next];
    setProvider(next);
    if (!baseUrl || baseUrl === previous.baseUrl) setBaseUrl(defaults.baseUrl);
    if (!initialModelId || initialModelId === previous.modelId) setInitialModelId(defaults.modelId);
  };
  const handleAddDialogChange = (open: boolean) => {
    setShowAdd(open);
    if (!open) resetAddForm();
  };

  const settings = settingsQuery.data;
  const readOnly = settings?.readOnly ?? true;
  const getDefaultProviderName = (index: number) => t("aiModel.defaultProviderName", {
    ordinal: formatProviderOrdinal(index + 1, locale),
  });
  const getProviderName = (item: NonNullable<typeof settings>["providers"][number], index: number) =>
    isLegacyProviderDisplayName(item.displayName, item.provider) ? getDefaultProviderName(index) : item.displayName;
  const allModels = settings?.providers.flatMap((item, index) =>
    item.models.map((model) => ({ ...model, providerName: getProviderName(item, index), providerEnabled: item.isEnabled }))) ?? [];
  const defaultModelAvailable = !settings?.defaultModelId
    || allModels.some((model) => model.id === settings.defaultModelId && model.providerEnabled);
  const error = defaultMutation.error ?? settingsQuery.error;
  const openAddDialog = () => {
    resetAddForm(getDefaultProviderName(settings?.providers.length ?? 0));
    setShowAdd(true);
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4 sm:p-5">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4.5 w-4.5 text-emerald-700" />
                  {t("aiModel.title")}
                </CardTitle>
                <CardDescription className="mt-1 text-xs text-slate-500">{t("aiModel.description")}</CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-5 p-4 pt-0 sm:px-5 sm:pb-5">
            {settingsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</p>
            ) : (
              <>
                {!settings?.encryptionConfigured ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t("aiModel.encryptionKeyMissing")}
                  </p>
                ) : null}

                <section className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-600">
                    {t("aiModel.defaultSettingsTitle")}
                  </span>
                  <div className="overflow-hidden rounded-lg border border-slate-200/70 bg-slate-50/50 divide-y divide-slate-200/70">
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{t("aiModel.defaultModel")}</div>
                        <div className="mt-0.5 text-xs leading-5 text-slate-500">{t("aiModel.defaultModelHint")}</div>
                      </div>
                      <div className="w-56 max-w-[60%] shrink-0 sm:w-72">
                        <Select
                          value={settings?.defaultModelId ?? "none"}
                          onValueChange={(value) => defaultMutation.mutate(value === "none" ? null : value)}
                          disabled={readOnly || defaultMutation.isPending}
                        >
                          <SelectTrigger className="h-8 bg-white text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("aiModel.noDefaultModel")}</SelectItem>
                            {allModels.map((model) => (
                              <SelectItem key={model.id} value={model.id} disabled={!model.providerEnabled}>
                                {model.displayName} · {model.providerName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-800">{t("settings.aiStreamingTitle")}</div>
                        <div className="mt-0.5 text-xs leading-5 text-slate-500">{t("settings.aiStreamingDescription")}</div>
                      </div>
                      <Switch
                        className="shrink-0"
                        checked={streamingEnabled}
                        onCheckedChange={(enabled) => {
                          writeAiStreamingPreference(enabled);
                          setStreamingEnabled(enabled);
                        }}
                        aria-label={t("settings.aiStreamingAria")}
                      />
                    </div>
                  </div>
                </section>
                {!defaultModelAvailable ? (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    {t("aiModel.defaultUnavailable")}
                  </p>
                ) : null}

                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-600">
                        {t("aiModel.servicesTitle")}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {settings?.providers.length ?? 0}
                      </span>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 bg-white text-xs" disabled={readOnly} onClick={openAddDialog}>
                      <Plus className="h-3.5 w-3.5" />{t("aiModel.addProvider")}
                    </Button>
                  </div>

                  {settings?.providers.length ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                      {settings.providers.map((item, index) => (
                        <AiProviderCard
                          key={item.id}
                          provider={item}
                          defaultDisplayName={getDefaultProviderName(index)}
                          defaultModelId={settings.defaultModelId}
                          readOnly={readOnly}
                          onChanged={refresh}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">{t("aiModel.noProviders")}</p>
                  )}
                </section>

                <Dialog open={showAdd} onOpenChange={handleAddDialogChange}>
                  <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
                    <form className="grid gap-5" onSubmit={(event: FormEvent) => { event.preventDefault(); createMutation.mutate(); }}>
                      <DialogHeader>
                        <DialogTitle>{t("aiModel.addProvider")}</DialogTitle>
                        <DialogDescription>{t("aiModel.addProviderDescription")}</DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("aiModel.displayName")}>
                          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} />
                        </Field>
                        <Field label={t("aiModel.provider")}>
                          <Select value={provider} onValueChange={(value) => handleProviderChange(value as AiProvider)}>
                            <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="openai-compatible">{t("aiModel.providers.openai-compatible")}</SelectItem>
                              <SelectItem value="anthropic">{t("aiModel.providers.anthropic")}</SelectItem>
                              <SelectItem value="google">{t("aiModel.providers.google")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <div className="sm:col-span-2">
                          <Field label={t("aiModel.baseUrl")}><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required inputMode="url" /></Field>
                        </div>
                        <div className="sm:col-span-2">
                          <Field label={t("aiModel.apiKey")} hint={t("aiModel.apiKeyCreateHint")}>
                            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required autoComplete="new-password" />
                          </Field>
                        </div>
                        <div className="sm:col-span-2">
                          <Field label={t("aiModel.initialModelId")} hint={t("aiModel.initialModelIdHint")}>
                            <Input value={initialModelId} onChange={(event) => setInitialModelId(event.target.value)} />
                          </Field>
                        </div>
                      </div>
                      {createMutation.isError ? (
                        <p className="text-xs font-medium text-rose-600" role="alert">
                          {aiErrorMessage(createMutation.error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"))}
                        </p>
                      ) : null}
                      <DialogFooter className="gap-2 sm:space-x-0">
                        <Button type="button" variant="outline" onClick={() => handleAddDialogChange(false)}>{t("common.cancel")}</Button>
                        <Button type="submit" variant="solid" disabled={readOnly || createMutation.isPending || !settings?.encryptionConfigured}>
                          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("aiModel.createProvider")}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                {error ? <p className="text-xs font-medium text-rose-600" role="alert">{aiErrorMessage(error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"))}</p> : null}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
    {label}{children}{hint ? <span className="text-xs font-normal leading-4 text-slate-500">{hint}</span> : null}
  </label>
);
