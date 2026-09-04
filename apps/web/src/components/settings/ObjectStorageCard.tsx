import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cloud, Database, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
  SETTINGS_ITEM_TITLE_CLASSNAME,
} from "./settings-ui";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiRequestError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Provider = "builtin" | "s3";

export const ObjectStorageCard = ({ demoMode }: { demoMode: boolean }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["instance-object-storage"], queryFn: api.getObjectStorageSettings });
  const [provider, setProvider] = useState<Provider>("builtin");
  const [displayName, setDisplayName] = useState("S3-compatible OSS");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [objectPrefix, setObjectPrefix] = useState("");

  useEffect(() => {
    if (!settingsQuery.data) return;
    const active = settingsQuery.data.settings;
    const savedExternal = settingsQuery.data.externalSettings ?? (active.provider === "s3" ? active : null);
    setProvider(active.provider);
    if (!savedExternal) return;
    setDisplayName(savedExternal.displayName);
    setEndpoint(savedExternal.endpoint ?? "");
    setRegion(savedExternal.region ?? "");
    setBucket(savedExternal.bucket ?? "");
    setAccessKeyId(savedExternal.accessKeyId ?? "");
    setForcePathStyle(savedExternal.forcePathStyle);
    setObjectPrefix(savedExternal.objectPrefix);
  }, [settingsQuery.data]);

  const s3Payload = () => ({
    endpoint,
    region,
    bucket,
    accessKeyId,
    ...(secretAccessKey ? { secretAccessKey } : {}),
    forcePathStyle,
    objectPrefix,
  });

  const testMutation = useMutation({ mutationFn: () => api.testObjectStorageConnection(s3Payload()) });
  const saveMutation = useMutation({
    mutationFn: () => provider === "builtin"
      ? api.updateObjectStorageSettings({ provider: "builtin" })
      : api.updateObjectStorageSettings({ provider: "s3", displayName, ...s3Payload() }),
    onSuccess: async () => {
      setSecretAccessKey("");
      await queryClient.invalidateQueries({ queryKey: ["instance-object-storage"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  const errorMessage = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "object_storage_authentication_required") {
      return t("objectStorage.authenticationRequired");
    }
    return error instanceof Error ? error.message : t("objectStorage.failed");
  };

  const encryptionConfigured = settingsQuery.data?.settings.encryptionConfigured ?? false;
  const hasSavedSecret = settingsQuery.data?.externalSettings?.hasSecretAccessKey
    ?? (settingsQuery.data?.settings.provider === "s3" && settingsQuery.data.settings.hasSecretAccessKey);

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
          <Cloud className={SETTINGS_CARD_ICON_CLASSNAME} />
          {t("objectStorage.title")}
        </CardTitle>
        <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
          {t("objectStorage.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:px-5 sm:pb-5">
        {settingsQuery.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{t("common.loading")}</p>
        ) : (
          <form className="grid gap-5" onSubmit={submit}>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["builtin", "s3"] as Provider[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setProvider(item); testMutation.reset(); saveMutation.reset(); }}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    provider === item ? "border-emerald-500 bg-emerald-50/70" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  {item === "builtin" ? <Database className="mt-0.5 h-4 w-4 text-emerald-700" /> : <Cloud className="mt-0.5 h-4 w-4 text-emerald-700" />}
                  <span><span className={cn("block", SETTINGS_ITEM_TITLE_CLASSNAME)}>{t(`objectStorage.providers.${item}.title`)}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{t(`objectStorage.providers.${item}.description`)}</span></span>
                </button>
              ))}
            </div>

            {provider === "s3" ? (
              <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                {!encryptionConfigured ? (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t("objectStorage.authenticationRequired")}
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("objectStorage.displayName")}><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></Field>
                  <Field label={t("objectStorage.endpoint")}><Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://s3.example.com" required inputMode="url" /></Field>
                  <Field label={t("objectStorage.region")}><Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" required /></Field>
                  <Field label={t("objectStorage.bucket")}><Input value={bucket} onChange={(event) => setBucket(event.target.value)} required /></Field>
                  <Field label={t("objectStorage.accessKeyId")}><Input value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} required autoComplete="off" /></Field>
                  <Field label={t("objectStorage.secretAccessKey")} hint={hasSavedSecret ? t("objectStorage.secretSavedHint") : undefined}><Input type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} required={!hasSavedSecret} autoComplete="new-password" placeholder={hasSavedSecret ? "••••••••••••" : ""} /></Field>
                  <Field label={t("objectStorage.objectPrefix")} hint={t("objectStorage.objectPrefixHint")}><Input value={objectPrefix} onChange={(event) => setObjectPrefix(event.target.value)} placeholder="edgeever" /></Field>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700">
                    <span><span className="block">{t("objectStorage.pathStyle")}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{t("objectStorage.pathStyleHint")}</span></span>
                    <Switch checked={forcePathStyle} onCheckedChange={setForcePathStyle} />
                  </label>
                </div>
              </div>
            ) : null}

            {(testMutation.isSuccess || saveMutation.isSuccess) ? <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{saveMutation.isSuccess ? t("objectStorage.saved") : t("objectStorage.testSucceeded")}</p> : null}
            {testMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{errorMessage(testMutation.error)}</p> : null}
            {saveMutation.isError ? <p className="text-xs font-medium text-rose-600" role="alert">{errorMessage(saveMutation.error)}</p> : null}

            <div className="flex flex-wrap justify-end gap-2">
              {provider === "s3" ? <Button type="button" variant="outline" disabled={testMutation.isPending || saveMutation.isPending} onClick={() => testMutation.mutate()}>{testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("objectStorage.test")}</Button> : null}
              <Button type="submit" disabled={demoMode || saveMutation.isPending || (provider === "s3" && !encryptionConfigured)}>{saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("common.save")}</Button>
            </div>
            <p className="text-xs leading-5 text-slate-500">{demoMode ? t("objectStorage.demoDisabled") : t("objectStorage.switchHint")}</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
    {label}
    {children}
    {hint ? <span className="text-xs font-normal leading-4 text-slate-500">{hint}</span> : null}
  </label>
);
