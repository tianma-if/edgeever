import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiProvider } from "@edgeever/shared";
import { ChevronDown, Loader2, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiProviderCard } from "@/components/settings/AiProviderCard";
import { aiErrorMessage, providerDefaults } from "@/components/settings/ai-provider-options";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const AiModelCard = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["ai-settings"], queryFn: api.getAiSettings });
  const [expanded, setExpanded] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState<AiProvider>("openai-compatible");
  const [displayName, setDisplayName] = useState(providerDefaults["openai-compatible"].displayName);
  const [baseUrl, setBaseUrl] = useState(providerDefaults["openai-compatible"].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [initialModelId, setInitialModelId] = useState(providerDefaults["openai-compatible"].modelId);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
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
      setApiKey("");
      setShowAdd(false);
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
    if (!displayName || displayName === previous.displayName) setDisplayName(defaults.displayName);
    if (!baseUrl || baseUrl === previous.baseUrl) setBaseUrl(defaults.baseUrl);
    if (!initialModelId || initialModelId === previous.modelId) setInitialModelId(defaults.modelId);
  };

  const resetAddForm = () => {
    setProvider("openai-compatible");
    setDisplayName(providerDefaults["openai-compatible"].displayName);
    setBaseUrl(providerDefaults["openai-compatible"].baseUrl);
    setInitialModelId(providerDefaults["openai-compatible"].modelId);
    setApiKey("");
    createMutation.reset();
  };

  const settings = settingsQuery.data;
  const readOnly = settings?.readOnly ?? true;
  const allModels = settings?.providers.flatMap((item) =>
    item.models.map((model) => ({ ...model, providerName: item.displayName, providerEnabled: item.isEnabled }))) ?? [];
  const defaultModelAvailable = !settings?.defaultModelId
    || allModels.some((model) => model.id === settings.defaultModelId && model.providerEnabled);
  const error = createMutation.error ?? defaultMutation.error ?? settingsQuery.error;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4 sm:p-5">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-emerald-700" />
                  {t("aiModel.title")}
                </CardTitle>
                <CardDescription className="mt-1">{t("aiModel.description")}</CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-4 p-4 pt-0 sm:px-5 sm:pb-5">
            {settingsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</p>
            ) : (
              <>
                {!settings?.encryptionConfigured ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t("aiModel.encryptionKeyMissing")}
                  </p>
                ) : null}

                <Field label={t("aiModel.defaultModel")}>
                  <Select
                    value={settings?.defaultModelId ?? "none"}
                    onValueChange={(value) => defaultMutation.mutate(value === "none" ? null : value)}
                    disabled={readOnly || defaultMutation.isPending}
                  >
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("aiModel.noDefaultModel")}</SelectItem>
                      {allModels.map((model) => (
                        <SelectItem key={model.id} value={model.id} disabled={!model.providerEnabled}>
                          {model.providerName} · {model.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {!defaultModelAvailable ? (
                  <p className="flex items-center gap-2 text-xs text-amber-700"><TriangleAlert className="h-4 w-4" />{t("aiModel.defaultUnavailable")}</p>
                ) : null}

                <div className="grid gap-3">
                  {settings?.providers.map((item) => (
                    <AiProviderCard key={item.id} provider={item} readOnly={readOnly} onChanged={refresh} />
                  ))}
                  {!settings?.providers.length ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-slate-500">{t("aiModel.noProviders")}</p> : null}
                </div>

                {showAdd ? (
                  <form className="grid gap-4 rounded-lg border bg-slate-50/60 p-4" onSubmit={(event: FormEvent) => { event.preventDefault(); createMutation.mutate(); }}>
                    <h3 className="text-sm font-semibold text-slate-900">{t("aiModel.addProvider")}</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
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
                      <Field label={t("aiModel.displayName")}><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></Field>
                      <Field label={t("aiModel.baseUrl")}><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required inputMode="url" /></Field>
                      <Field label={t("aiModel.initialModelId")}><Input value={initialModelId} onChange={(event) => setInitialModelId(event.target.value)} /></Field>
                      <div className="sm:col-span-2"><Field label={t("aiModel.apiKey")}><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required autoComplete="new-password" /></Field></div>
                    </div>
                    {createMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{aiErrorMessage(createMutation.error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"))}</p> : null}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => { setShowAdd(false); resetAddForm(); }}>{t("common.cancel")}</Button>
                      <Button type="submit" disabled={readOnly || createMutation.isPending || !settings?.encryptionConfigured}>
                        {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("aiModel.createProvider")}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button type="button" variant="outline" className="justify-self-start" disabled={readOnly} onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" />{t("aiModel.addProvider")}</Button>
                )}

                {error && !createMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{aiErrorMessage(error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"))}</p> : null}
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
