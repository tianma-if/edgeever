import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import katex from "katex";
import { Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MathFormulaDraft, MathFormulaKind } from "@/components/editor/math-formula";
import { MathVisualInput } from "@/components/editor/MathVisualInput";
import { hasMathPlaceholders, renderMathPreview } from "@/components/editor/math-formula-preview";

export const MathFormulaDialog = ({
  open,
  draft,
  onOpenChange,
  onApply,
  onRemove,
}: {
  open: boolean;
  draft: MathFormulaDraft | null;
  onOpenChange: (open: boolean) => void;
  onApply: (draft: MathFormulaDraft) => void;
  onRemove?: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const latexId = useId();
  const previewId = useId();
  const latexInputRef = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<MathFormulaKind>(draft?.kind ?? "inline");
  const [latex, setLatex] = useState(draft?.latex ?? "");
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"visual" | "source">("visual");
  const editing = typeof draft?.pos === "number";

  useEffect(() => {
    if (!open) return;
    setKind(draft?.kind ?? "inline");
    setLatex(draft?.latex ?? "");
    setError(null);
    setInputMode("visual");
  }, [draft, open]);

  useEffect(() => {
    if (open && inputMode === "source") latexInputRef.current?.focus();
  }, [inputMode, open]);

  const previewHtml = useMemo(() => renderMathPreview(latex, kind), [kind, latex]);
  const incomplete = hasMathPlaceholders(latex);

  const submit = () => {
    if (incomplete) return;
    if (!latex.trim()) {
      setError(t("mathFormulaDialog.errorEmpty"));
      return;
    }
    try {
      katex.renderToString(latex.trim(), { throwOnError: true, trust: false, strict: "warn" });
    } catch {
      setError(t("mathFormulaDialog.previewError"));
      return;
    }
    onApply({
      kind,
      latex,
      pos: draft?.pos,
      from: draft?.from,
      to: draft?.to,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm leading-6">
            <Sigma className="h-5 w-5 text-slate-700" />
            {editing ? t("mathFormulaDialog.editTitle") : t("mathFormulaDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {!editing && (
            <div className="flex rounded-md border border-slate-200 p-0.5">
              {(["inline", "block"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    kind === value
                      ? "flex-1 rounded-sm bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      : "flex-1 rounded-sm px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  }
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                >
                  {value === "inline" ? t("mathFormulaDialog.inline") : t("mathFormulaDialog.block")}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={latexId} className="text-xs font-medium text-slate-600">
                {t(inputMode === "visual" ? "mathFormulaDialog.visualLabel" : "mathFormulaDialog.latexLabel")}
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                setInputMode(inputMode === "visual" ? "source" : "visual");
                setError(null);
              }}>
                {t(inputMode === "visual" ? "mathFormulaDialog.sourceMode" : "mathFormulaDialog.visualMode")}
              </Button>
            </div>
            {inputMode === "visual" ? (open ? (
              <MathVisualInput
                id={latexId}
                value={latex}
                label={t("mathFormulaDialog.visualLabel")}
                loadingLabel={t("mathFormulaDialog.loading")}
                language={i18n.resolvedLanguage ?? i18n.language}
                hint={incomplete ? t("mathFormulaDialog.incomplete") : undefined}
                onChange={(value) => { setLatex(value); setError(null); }}
                onLoadError={() => { setInputMode("source"); setError(t("mathFormulaDialog.loadError")); }}
              />
            ) : null) : (
            <textarea
              ref={latexInputRef}
              id={latexId}
              value={latex}
              rows={3}
              spellCheck={false}
              className="w-full resize-y rounded-md border border-slate-200 bg-card px-3 py-2 font-mono text-sm text-slate-900 outline-none ring-slate-900/15 placeholder:text-slate-400 focus:border-slate-900 focus:ring-2"
              placeholder={t("mathFormulaDialog.latexPlaceholder")}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => {
                setLatex(event.target.value);
                if (error) setError(null);
              }}
            />
            )}
            {inputMode === "source" && incomplete && <p className="text-xs leading-5 text-slate-500" role="status">{t("mathFormulaDialog.incomplete")}</p>}
          </div>

          <div className="space-y-1.5">
            <p id={previewId} className="text-xs font-medium text-slate-600">
              {t("mathFormulaDialog.preview")}
            </p>
            <div
              aria-labelledby={previewId}
              className={
                kind === "block"
                  ? "min-h-16 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-center"
                  : "min-h-12 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
              }
            >
              {latex.trim() ? (
                previewHtml ? (
                  <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <p className="text-xs leading-5 text-rose-700">{t("mathFormulaDialog.previewError")}</p>
                )
              ) : (
                <p className="text-xs leading-5 text-slate-400">{t("mathFormulaDialog.previewEmpty")}</p>
              )}
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-600" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 border-t border-slate-100 pt-4 sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {editing && onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                  onClick={() => {
                    onRemove();
                    onOpenChange(false);
                  }}
                >
                  {t("mathFormulaDialog.remove")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="solid" disabled={incomplete}>
                {t("mathFormulaDialog.apply")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
