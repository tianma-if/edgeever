import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { PublicTableForm, PublicTableFormField } from "@edgeever/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withEnvironmentTitlePrefix } from "@/lib/environment-title";

const FORM_FILE_LIMIT = 20 * 1024 * 1024;

const submissionCells = (form: PublicTableForm, values: Record<string, unknown>) =>
  Object.fromEntries(form.fields.map((field) => {
    const value = values[field.id] ?? emptyValue(field);
    if (field.type === "attachment" && Array.isArray(value)) {
      return [field.id, value.map((file: { id: string }) => ({ resourceId: file.id }))];
    }
    if (field.type === "number") return [field.id, value === "" ? null : Number(value)];
    return [field.id, value];
  }));

const emptyValue = (field: PublicTableFormField) => {
  if (field.type === "checkbox") return false;
  if (field.type === "attachment") return [] as { id: string; filename: string }[];
  if (field.type === "multiSelect") return [] as string[];
  return "";
};

export const PublicTableFormPage = () => {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["public-table-form", token] as const;
  const formQuery = useQuery({
    queryKey,
    queryFn: () => api.getPublicTableForm(token),
    enabled: Boolean(token),
    retry: false,
  });
  const form = formQuery.data?.form;
  const [password, setPassword] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    if (!form || form.passwordRequired) return;
    document.title = withEnvironmentTitlePrefix(form.title || t("structuredTable.form.title"), {
      development: import.meta.env.DEV,
      profile: __EDGEEVER_DEVELOPMENT_PROFILE__,
    });
    setValues(Object.fromEntries(form.fields.map((field) => [field.id, emptyValue(field)])));
  }, [form, t]);

  const unlockMutation = useMutation({
    mutationFn: () => api.unlockPublicTableForm(token, password),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (reason: Error) => setError(reason.message),
  });

  const submitMutation = useMutation({
    mutationFn: (cells: Record<string, unknown>) => api.submitPublicTableForm(token, cells),
    onSuccess: () => {
      setDone(true);
      setError(null);
    },
    onError: (reason: Error) => setError(reason.message),
  });

  const upload = async (fieldId: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(fieldId);
    setError(null);
    try {
      const current = Array.isArray(values[fieldId]) ? values[fieldId] as { id: string; filename: string }[] : [];
      const next = [...current];
      for (const file of files) {
        if (file.size > FORM_FILE_LIMIT) throw new Error(t("structuredTable.form.uploadLimit"));
        if (next.length >= 10) break;
        const uploaded = await api.uploadPublicTableFormFile(token, file);
        next.push({ id: uploaded.resource.id, filename: uploaded.resource.filename });
      }
      setValues((previous) => ({ ...previous, [fieldId]: next }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("structuredTable.saveError"));
    } finally {
      setUploading(null);
    }
  };

  if (formQuery.isLoading) {
    return <div className="grid min-h-screen place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-slate-500" /></div>;
  }
  if (formQuery.isError || !form) {
    return <div className="grid min-h-screen place-items-center px-6 text-sm text-slate-600">{t("structuredTable.form.closed")}</div>;
  }
  if (form.passwordRequired) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50/60 px-4">
        <main className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-card p-8 shadow-sm space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">{t("structuredTable.form.passwordRequired")}</h1>
          <Input
            type="password"
            value={password}
            autoComplete="off"
            aria-label={t("structuredTable.form.password")}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <Button
            type="button"
            variant="solid"
            className="w-full font-medium shadow-sm"
            disabled={!password || unlockMutation.isPending}
            onClick={() => unlockMutation.mutate()}
          >
            {t("structuredTable.form.unlock")}
          </Button>
        </main>
      </div>
    );
  }
  if (done) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50/60 px-4">
        <main className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-card p-8 shadow-sm space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700">
            <Check className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{t("structuredTable.form.submitted")}</h1>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setDone(false);
              setValues(Object.fromEntries(form.fields.map((field) => [field.id, emptyValue(field)])));
            }}
          >
            {t("structuredTable.form.submitAnother")}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/60 py-8 px-4 sm:px-6">
      <main className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200/80 bg-card p-6 sm:p-8 shadow-sm">
        <header className="space-y-2 pb-5 border-b border-slate-100">
          <h1 className="text-2xl font-semibold text-slate-950">{form.title || t("structuredTable.form.title")}</h1>
          {form.description ? <p className="text-sm text-slate-600 leading-relaxed">{form.description}</p> : null}
        </header>
        {form.full ? <p className="mt-4 text-sm font-medium text-amber-600">{t("structuredTable.form.full")}</p> : null}
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.full) submitMutation.mutate(submissionCells(form, values));
          }}
        >
          {form.fields.map((field) => {
            const value = values[field.id] ?? emptyValue(field);
            const label = field.required ? `${field.name} *` : field.name;
            return (
              <label key={field.id} className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-800">{label}</span>
                {field.type === "checkbox" ? (
                  <div className="pt-0.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                      checked={value === true}
                      aria-label={field.name}
                      onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.checked }))}
                    />
                  </div>
                ) : field.type === "select" ? (
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 bg-card px-3 text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                    value={typeof value === "string" ? value : ""}
                    required={field.required}
                    aria-label={field.name}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  >
                    <option value="" />
                    {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : field.type === "multiSelect" ? (
                  <div className="space-y-1.5 rounded-md border border-slate-200 bg-card p-3">
                    {(field.options ?? []).map((option) => {
                      const selected = Array.isArray(value) ? value.includes(option) : false;
                      return (
                        <label key={option} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                            checked={selected}
                            aria-label={option}
                            onChange={(event) => setValues((current) => {
                              const currentValue = current[field.id] ?? emptyValue(field);
                              const selectedValues = Array.isArray(currentValue) ? currentValue as string[] : [];
                              const nextValues = event.target.checked
                                ? [...selectedValues, option]
                                : selectedValues.filter((item) => item !== option);
                              return { ...current, [field.id]: nextValues };
                            })}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : field.type === "attachment" ? (
                  <div className="space-y-1">
                    {Array.isArray(value) ? value.map((file) => (
                      <p key={file.id} className="truncate text-slate-600">{file.filename}</p>
                    )) : null}
                    <input
                      type="file"
                      multiple
                      aria-label={field.name}
                      disabled={uploading === field.id}
                      onChange={(event) => { void upload(field.id, event.target.files); event.target.value = ""; }}
                    />
                    <p className="text-xs text-slate-500">{uploading === field.id ? t("structuredTable.uploading") : t("structuredTable.form.uploadLimit")}</p>
                  </div>
                ) : (
                  <Input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
                    value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                    required={field.required}
                    aria-label={field.name}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: field.type === "number" ? event.target.value : event.target.value }))}
                  />
                )}
              </label>
            );
          })}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="pt-2">
            <Button
              type="submit"
              variant="solid"
              size="default"
              className="w-full sm:w-auto min-w-[120px] font-medium shadow-sm"
              disabled={form.full || submitMutation.isPending || Boolean(uploading)}
            >
              {submitMutation.isPending ? t("structuredTable.form.saving") : form.submitLabel || t("structuredTable.form.submitDefault")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
};
