import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AiDiscoveredModel, AiProvider, AiProviderConfig } from "@edgeever/shared";
import { CheckCircle2, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aiErrorMessage, providerDefaults } from "@/components/settings/ai-provider-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export const AiProviderCard = ({ provider: saved, readOnly, onChanged }: {
  provider: AiProviderConfig;
  readOnly: boolean;
  onChanged: () => Promise<unknown>;
}) => {
  const { t } = useTranslation();
  const datalistId = `ai-models-${useId().replaceAll(":", "")}`;
  const [provider, setProvider] = useState<AiProvider>(saved.provider);
  const [displayName, setDisplayName] = useState(saved.displayName);
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<AiDiscoveredModel[]>([]);

  useEffect(() => {
    setProvider(saved.provider);
    setDisplayName(saved.displayName);
    setBaseUrl(saved.baseUrl);
  }, [saved.baseUrl, saved.displayName, saved.provider]);

  const updateMutation = useMutation({
    mutationFn: (isEnabled: boolean = saved.isEnabled) => api.updateAiProvider(saved.id, {
      provider,
      displayName,
      baseUrl,
      isEnabled,
      ...(apiKey ? { apiKey } : {}),
    }),
    onSuccess: async () => { setApiKey(""); await onChanged(); },
  });
  const deleteMutation = useMutation({ mutationFn: () => api.deleteAiProvider(saved.id), onSuccess: onChanged });
  const testMutation = useMutation({
    mutationFn: () => api.testAiProvider(saved.id, { modelId: saved.models[0]?.modelId ?? "" }),
  });
  const discoverMutation = useMutation({
    mutationFn: () => api.discoverAiProviderModels(saved.id),
    onSuccess: ({ models }) => setDiscoveredModels(models),
  });
  const addModelMutation = useMutation({
    mutationFn: () => {
      const discovered = discoveredModels.find((item) => item.modelId === modelId.trim());
      return api.addAiModel(saved.id, { modelId: modelId.trim(), ...(discovered ? { displayName: discovered.displayName } : {}) });
    },
    onSuccess: async () => { setModelId(""); await onChanged(); },
  });
  const deleteModelMutation = useMutation({
    mutationFn: (modelConfigId: string) => api.deleteAiModel(saved.id, modelConfigId),
    onSuccess: onChanged,
  });

  const mutations = [updateMutation, deleteMutation, testMutation, discoverMutation, addModelMutation, deleteModelMutation];
  const mutationError = mutations.find((item) => item.isError)?.error;
  const isBusy = mutations.some((item) => item.isPending);
  const handleProviderChange = (next: AiProvider) => {
    const previous = providerDefaults[provider];
    const defaults = providerDefaults[next];
    setProvider(next);
    if (!displayName || displayName === previous.displayName) setDisplayName(defaults.displayName);
    if (!baseUrl || baseUrl === previous.baseUrl) setBaseUrl(defaults.baseUrl);
  };

  const submit = (event: FormEvent) => { event.preventDefault(); updateMutation.mutate(saved.isEnabled); };
  const deleteProvider = () => {
    if (window.confirm(t("aiModel.deleteProviderConfirm", { name: saved.displayName }))) deleteMutation.mutate();
  };

  return (
    <section className="grid gap-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">{saved.displayName}</h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">{saved.baseUrl}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-slate-500 sm:inline">{t("aiModel.serviceEnabled")}</span>
          <Switch
            checked={saved.isEnabled}
            disabled={readOnly || updateMutation.isPending}
            aria-label={t("aiModel.serviceEnabled")}
            onCheckedChange={(checked) => updateMutation.mutate(checked)}
          />
        </div>
      </div>

      <form className="grid gap-4" onSubmit={submit}>
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
          <Field label={t("aiModel.apiKey")}>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder="••••••••••••" />
          </Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" className="mr-auto text-rose-600 hover:text-rose-700" disabled={readOnly || isBusy} onClick={deleteProvider}><Trash2 className="h-4 w-4" />{t("common.delete")}</Button>
          <Button type="button" variant="outline" disabled={isBusy || !saved.hasApiKey || saved.models.length === 0} onClick={() => testMutation.mutate()}>
            {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("aiModel.test")}
          </Button>
          <Button type="submit" disabled={readOnly || isBusy}>{updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("common.save")}</Button>
        </div>
      </form>

      <div className="grid gap-3 border-t pt-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{t("aiModel.modelsTitle")}</h4>
          <p className="mt-0.5 text-xs text-slate-500">{t("aiModel.modelsHint")}</p>
        </div>
        {saved.models.length ? (
          <div className="grid gap-2">
            {saved.models.map((model) => (
              <div key={model.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                <div className="min-w-0"><p className="truncate text-sm text-slate-800">{model.displayName}</p><p className="truncate text-xs text-slate-500">{model.modelId}</p></div>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-500" disabled={readOnly || deleteModelMutation.isPending} onClick={() => deleteModelMutation.mutate(model.id)} aria-label={t("aiModel.removeModel")}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-slate-500">{t("aiModel.noModels")}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <Input list={datalistId} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder={t("aiModel.modelIdPlaceholder")} />
            <datalist id={datalistId}>{discoveredModels.map((model) => <option key={model.modelId} value={model.modelId}>{model.displayName}</option>)}</datalist>
          </div>
          <Button type="button" variant="outline" disabled={isBusy || !saved.hasApiKey} onClick={() => discoverMutation.mutate()}>
            {discoverMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{t("aiModel.discoverModels")}
          </Button>
          <Button type="button" disabled={readOnly || isBusy || !modelId.trim()} onClick={() => addModelMutation.mutate()}>
            {addModelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t("aiModel.addModel")}
          </Button>
        </div>
        {discoverMutation.isSuccess ? <p className="text-xs text-emerald-700">{t("aiModel.discoveryComplete", { count: discoveredModels.length })}</p> : null}
      </div>

      {testMutation.isSuccess || updateMutation.isSuccess ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{testMutation.isSuccess ? t("aiModel.testSucceeded") : t("aiModel.saved")}</p>
      ) : null}
      {mutationError ? <p className="text-xs font-medium text-rose-600" role="alert">{aiErrorMessage(mutationError, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"))}</p> : null}
    </section>
  );
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="grid gap-1.5 text-sm font-medium text-slate-700">{label}{children}{hint ? <span className="text-xs font-normal leading-4 text-slate-500">{hint}</span> : null}</label>
);
