import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { PluginManifest, PluginSettingField, PluginSettingValue } from "@edgeever/plugin-api";
import type { EdgeEverPluginHost } from "@/lib/plugins/plugin-host";
import {
  createPluginSettingWriteQueue,
  planPluginSettingWrite,
  pluginSettingLoadSignature,
} from "./plugin-settings-commit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SETTINGS_ITEM_TITLE_CLASSNAME } from "@/components/settings/settings-ui";
import { groupPluginSettingFields } from "./plugin-settings-layout";
import { localizePluginSettingField } from "./plugin-settings-localization";

const PluginSettingListDialog = ({ field }: { field: PluginSettingField }) => {
  const { t } = useTranslation();
  const list = field.list;
  if (!list) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 mt-0.5 h-7 gap-0.5 px-2 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          aria-haspopup="dialog"
        >
          {list.actionLabel ?? t("plugins.settings.viewList")}
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[min(720px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="space-y-1.5 border-b border-slate-200 p-6 pb-4 pr-12 text-left">
          <DialogTitle>{list.title ?? field.label}</DialogTitle>
          <DialogDescription>{t("plugins.settings.listCount", { count: list.items.length })}</DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 divide-y divide-slate-100 overflow-y-auto pb-1">
          {list.items.map((item, index) => (
            <li key={`${item.title}:${item.description ?? ""}:${index}`} className="px-6 py-3">
              <div className="text-xs font-normal leading-5 text-slate-800">{item.title}</div>
              {item.description ? <div className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</div> : null}
            </li>
          ))}
        </ul>
        <DialogFooter className="border-t border-slate-200 p-4 sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm">{t("common.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PluginSettingFieldRow = ({
  configuredSecret,
  compact = false,
  disabled,
  field,
  inputId,
  onBlur,
  onChange,
  value,
}: {
  configuredSecret: boolean;
  compact?: boolean;
  disabled: boolean;
  field: PluginSettingField;
  inputId: string;
  onBlur?: () => void;
  onChange: (value: PluginSettingValue | "") => void;
  value: PluginSettingValue | "";
}) => {
  const { t } = useTranslation();
  const descriptionId = field.description ? `${inputId}-description` : undefined;
  const label = (
    <label htmlFor={inputId} className={`block ${SETTINGS_ITEM_TITLE_CLASSNAME}`}>
      {field.label}
      {field.required ? <span className="ml-1 text-rose-600" aria-hidden="true">*</span> : null}
    </label>
  );

  const content = (
    <>
      <div className="min-w-0">
        {label}
        {field.description ? <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-500">{field.description}</p> : null}
        <PluginSettingListDialog field={field} />
      </div>
      <div className={field.type === "boolean" ? "shrink-0 pt-0.5" : "min-w-0 md:max-w-xl"}>
        {field.type === "boolean" ? (
          <Switch
            id={inputId}
            aria-describedby={descriptionId}
            aria-label={field.label}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={onChange}
          />
        ) : field.type === "select" ? (
          <Select
            disabled={disabled}
            value={value === "" ? (field.required ? "" : "none") : `option:${value}`}
            onValueChange={(next) => onChange(next === "none" ? "" : next.slice(7))}
          >
            <SelectTrigger id={inputId} aria-describedby={descriptionId} aria-required={field.required}>
              <SelectValue placeholder={t("plugins.settings.none")} />
            </SelectTrigger>
            <SelectContent>
              {!field.required ? <SelectItem value="none">{t("plugins.settings.none")}</SelectItem> : null}
              {field.options.map((option) => <SelectItem key={option.value} value={`option:${option.value}`}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={inputId}
            aria-describedby={descriptionId}
            required={field.required && !(field.type === "secret" && configuredSecret)}
            autoComplete={field.type === "secret" ? "new-password" : "off"}
            disabled={disabled}
            type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
            value={String(value)}
            placeholder={field.type === "secret" && configuredSecret
              ? t("plugins.settings.secretConfigured")
              : field.type === "text" || field.type === "secret"
                ? field.placeholder
                : undefined}
            min={field.type === "number" ? field.min : undefined}
            max={field.type === "number" ? field.max : undefined}
            step={field.type === "number" ? field.step ?? "any" : undefined}
            onBlur={onBlur}
            onChange={(event) => onChange(
              field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value,
            )}
          />
        )}
      </div>
    </>
  );

  if (compact) {
    return (
      <div className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-slate-50/60 p-3">
        {content}
      </div>
    );
  }

  return (
    <div className={field.type === "boolean"
      ? "flex min-w-0 items-start justify-between gap-4 py-3.5"
      : "grid min-w-0 gap-3 py-3.5 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-8"}>
      {content}
    </div>
  );
};

export const PluginSettingsSection = ({ host, manifest }: { host: EdgeEverPluginHost; manifest: PluginManifest }) => {
  const { t, i18n } = useTranslation();
  const formId = useId();
  const fields = manifest.settings?.fields ?? [];
  const localizedFields = fields.map((field) => localizePluginSettingField(field, i18n.resolvedLanguage ?? i18n.language));
  const fieldGroups = groupPluginSettingFields(localizedFields);
  const fieldLoadSignature = pluginSettingLoadSignature(fields);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const settingWrites = useRef(createPluginSettingWriteQueue()).current;
  const valuesRef = useRef<Record<string, PluginSettingValue | "">>({});
  const committedRef = useRef<Record<string, PluginSettingValue | "">>({});
  const revisionRef = useRef<Record<string, number>>({});
  const loadedRef = useRef(false);
  const [values, setValues] = useState<Record<string, PluginSettingValue | "">>({});
  const [configuredSecrets, setConfiguredSecrets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(fields.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  valuesRef.current = values;

  useEffect(() => {
    let active = true;
    const currentFields = fieldsRef.current;
    const started = { ...revisionRef.current };
    loadedRef.current = false;
    setLoading(currentFields.length > 0);
    setError(null);
    setLoadError(null);
    void Promise.all(currentFields.map(async (field) => {
      if (field.type === "secret") return { key: field.key, value: "" as const, configured: await host.hasSettingValue(manifest.id, field.key) };
      return { key: field.key, value: await host.getSettingValue(manifest.id, field.key) ?? "", configured: false };
    })).then((loaded) => {
      if (!active) return;
      setValues((current) => {
        const next = { ...current };
        for (const item of loaded) {
          if ((revisionRef.current[item.key] ?? 0) !== (started[item.key] ?? 0)) continue;
          next[item.key] = item.value;
          committedRef.current[item.key] = item.value;
        }
        return next;
      });
      setConfiguredSecrets(Object.fromEntries(loaded.map((item) => [item.key, item.configured])));
      loadedRef.current = true;
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });
    return () => { active = false; };
  }, [host, manifest.id, manifest.version, fieldLoadSignature, loadAttempt]);

  const flushSettings = () => {
    if (!loadedRef.current) return;
    for (const field of fieldsRef.current) {
      if ((revisionRef.current[field.key] ?? 0) === 0) continue;
      const plan = planPluginSettingWrite(field, valuesRef.current[field.key] ?? "");
      if (plan.action === "set") void host.setSettingValue(manifest.id, field.key, plan.value);
      else if (plan.action === "remove") void host.removeSettingValue(manifest.id, field.key);
    }
  };
  const flushRef = useRef(flushSettings);
  flushRef.current = flushSettings;

  useEffect(() => {
    const flush = () => flushRef.current();
    window.addEventListener("pagehide", flush);
    const stopHibernatePrepare = window.edgeeverDesktop?.onHibernatePrepare?.(flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      stopHibernatePrepare?.();
      flush();
    };
  }, [host, manifest.id]);

  if (fields.length === 0) return null;

  const settingError = (field: PluginSettingField, reason: "required" | "invalid") =>
    reason === "required"
      ? t("plugins.settings.required", { name: field.label })
      : t("plugins.settings.invalid", { name: field.label });

  const persistSetting = (field: PluginSettingField, value: PluginSettingValue | "") => {
    const plan = planPluginSettingWrite(field, value);
    if (plan.action === "keep") {
      if (plan.error) setError(settingError(field, plan.error));
      return;
    }
    const seen = revisionRef.current[field.key] ?? 0;
    void settingWrites.enqueue(field.key, async () => {
      try {
        if (plan.action === "set") await host.setSettingValue(manifest.id, field.key, plan.value);
        else await host.removeSettingValue(manifest.id, field.key);
        if ((revisionRef.current[field.key] ?? 0) !== seen) return;
        committedRef.current[field.key] = plan.action === "set" ? plan.value : "";
        if (field.type === "secret") setConfiguredSecrets((current) => ({ ...current, [field.key]: true }));
      } catch (writeError) {
        if ((revisionRef.current[field.key] ?? 0) !== seen) return;
        if (field.type === "boolean" || field.type === "select") {
          setValues((current) => current[field.key] === value
            ? { ...current, [field.key]: committedRef.current[field.key] ?? "" }
            : current);
        }
        setError(writeError instanceof Error ? writeError.message : String(writeError));
      }
    });
  };

  const changeSetting = (field: PluginSettingField, value: PluginSettingValue | "") => {
    revisionRef.current[field.key] = (revisionRef.current[field.key] ?? 0) + 1;
    valuesRef.current = { ...valuesRef.current, [field.key]: value };
    setError(null);
    setValues((current) => ({ ...current, [field.key]: value }));
    persistSetting(field, value);
  };

  const settleSetting = (field: PluginSettingField) => {
    const value = valuesRef.current[field.key] ?? "";
    const plan = planPluginSettingWrite(field, value);
    if (field.type === "secret") {
      if (plan.action !== "set") return;
      valuesRef.current = { ...valuesRef.current, [field.key]: "" };
      setValues((current) => current[field.key] === value ? { ...current, [field.key]: "" } : current);
      return;
    }
    if (plan.action === "keep") {
      const restored = committedRef.current[field.key] ?? "";
      valuesRef.current = { ...valuesRef.current, [field.key]: restored };
      setValues((current) => ({ ...current, [field.key]: restored }));
      setError(null);
    }
  };

  return (
    <section className="min-w-0" aria-labelledby={`${formId}-title`}>
      <header className="border-b border-slate-200 pb-3">
        <h3 id={`${formId}-title`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("plugins.settings.title")}</h3>
      </header>
      {loading ? <p className="py-8 text-xs leading-5 text-slate-500" role="status">{t("common.loading")}</p> : loadError ? (
        <div className="mt-4 grid justify-items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs leading-6 text-rose-700" role="alert">{t("plugins.settings.loadFailed", { message: loadError })}</p>
          <Button size="sm" variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("plugins.settings.retry")}</Button>
        </div>
      ) : (
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="divide-y divide-slate-100">
            {fieldGroups.map((group) => {
              const rows = group.fields.map((field) => {
                const value = values[field.key] ?? "";
                const inputId = `${formId}-${field.key}`;
                return (
                  <PluginSettingFieldRow
                    key={field.key}
                    compact={group.compact}
                    configuredSecret={Boolean(configuredSecrets[field.key])}
                    disabled={false}
                    field={field}
                    inputId={inputId}
                    value={value}
                    onBlur={field.type === "boolean" || field.type === "select" ? undefined : () => settleSetting(field)}
                    onChange={(nextValue) => changeSetting(field, nextValue)}
                  />
                );
              });
              return group.compact ? (
                <div key={group.id} className="py-3">
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {rows}
                  </div>
                </div>
              ) : (
                <div key={group.id} className="divide-y divide-slate-100">
                  {rows}
                </div>
              );
            })}
          </div>
          {error ? <p className="border-t border-slate-200 pt-3 text-xs leading-5 text-rose-700" role="alert">{t("plugins.settings.saveFailed", { message: error })}</p> : null}
        </form>
      )}
    </section>
  );
};
