import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiProvider } from "@edgeever/shared";
import { CheckCircle2, ChevronDown, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiRequestError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

const providerDefaults: Record<AiProvider, { displayName: string; baseUrl: string; modelId: string }> = {
  "openai-compatible": { displayName: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1-mini" },
  anthropic: { displayName: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelId: "claude-sonnet-4-5" },
  google: { displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "gemini-2.5-flash" },
};

export const AiModelCard = ({ demoMode }: { demoMode: boolean }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["ai-settings"], queryFn: api.getAiSettings });
  const [provider, setProvider] = useState<AiProvider>("openai-compatible");
  const [displayName, setDisplayName] = useState(providerDefaults["openai-compatible"].displayName);
  const [baseUrl, setBaseUrl] = useState(providerDefaults["openai-compatible"].baseUrl);
  const [modelId, setModelId] = useState(providerDefaults["openai-compatible"].modelId);
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setProvider(settings.provider);
    setDisplayName(settings.displayName);
    setBaseUrl(settings.baseUrl);
    setModelId(settings.modelId);
    setIsEnabled(settings.isEnabled);
  }, [settingsQuery.data]);

  const payload = () => ({
    provider,
    displayName,
    baseUrl,
    modelId,
    ...(apiKey ? { apiKey } : {}),
  });
  const testMutation = useMutation({ mutationFn: () => api.testAiConnection(payload()) });
  const saveMutation = useMutation({
    mutationFn: () => api.updateAiSettings({ ...payload(), isEnabled }),
    onSuccess: async () => {
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
    },
  });

  const handleProviderChange = (next: AiProvider) => {
    const previousDefaults = providerDefaults[provider];
    const nextDefaults = providerDefaults[next];
    setProvider(next);
    if (!displayName || displayName === previousDefaults.displayName) setDisplayName(nextDefaults.displayName);
    if (!baseUrl || baseUrl === previousDefaults.baseUrl) setBaseUrl(nextDefaults.baseUrl);
    if (!modelId || modelId === previousDefaults.modelId) setModelId(nextDefaults.modelId);
    testMutation.reset();
    saveMutation.reset();
  };

  const errorMessage = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "ai_encryption_key_missing") {
      return t("aiModel.encryptionKeyMissing");
    }
    return error instanceof Error ? error.message : t("aiModel.failed");
  };
  const encryptionConfigured = settingsQuery.data?.encryptionConfigured ?? false;
  const hasSavedKey = settingsQuery.data?.settings?.hasApiKey ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4 sm:p-5">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-emerald-700" />{t("aiModel.title")}</CardTitle>
                <CardDescription className="mt-1">{t("aiModel.description")}</CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded ? "rotate-180" : "rotate-0")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="p-4 pt-0 sm:px-5 sm:pb-5">
            {settingsQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</p>
            ) : (
              <form className="grid gap-4" onSubmit={submit}>
                {!encryptionConfigured ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t("aiModel.encryptionKeyMissing")}
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("aiModel.provider")}>
                    <Select value={provider} onValueChange={(value) => handleProviderChange(value as AiProvider)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai-compatible">{t("aiModel.providers.openai-compatible")}</SelectItem>
                        <SelectItem value="anthropic">{t("aiModel.providers.anthropic")}</SelectItem>
                        <SelectItem value="google">{t("aiModel.providers.google")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("aiModel.displayName")}><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></Field>
                  <Field label={t("aiModel.baseUrl")}><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required inputMode="url" /></Field>
                  <Field label={t("aiModel.modelId")}><Input value={modelId} onChange={(event) => setModelId(event.target.value)} required /></Field>
                  <Field label={t("aiModel.apiKey")} hint={hasSavedKey ? t("aiModel.apiKeySavedHint") : undefined}>
                    <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required={!hasSavedKey} autoComplete="new-password" placeholder={hasSavedKey ? "••••••••••••" : ""} />
                  </Field>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700">
                    <span><span className="block">{t("aiModel.enabled")}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{t("aiModel.enabledHint")}</span></span>
                    <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
                  </label>
                </div>
                {testMutation.isSuccess ? <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t("aiModel.testSucceeded")}</p> : null}
                {saveMutation.isSuccess ? <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t("aiModel.saved")}</p> : null}
                {testMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{errorMessage(testMutation.error)}</p> : null}
                {saveMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{errorMessage(saveMutation.error)}</p> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" disabled={testMutation.isPending || saveMutation.isPending || (!apiKey && !hasSavedKey)} onClick={() => testMutation.mutate()}>{testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("aiModel.test")}</Button>
                  <Button type="submit" disabled={demoMode || saveMutation.isPending || !encryptionConfigured || (!apiKey && !hasSavedKey)}>{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("common.save")}</Button>
                </div>
              </form>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="grid gap-1.5 text-sm font-medium text-slate-700">{label}{children}{hint ? <span className="text-xs font-normal leading-4 text-slate-500">{hint}</span> : null}</label>
);
