import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AI_MODEL_OUTPUT_BUDGET_DEFAULTS,
  AI_MODEL_OUTPUT_BUDGET_FIELDS,
  AI_MODEL_OUTPUT_BUDGET_LIMITS,
  type AiModelConfig,
  type AiModelConfigUpdateInput,
  type AiModelOutputBudgetField,
} from "@edgeever/shared";
import { Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aiErrorMessage } from "@/components/settings/ai-provider-options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  aiModelOutputBudgetChanges,
  aiModelOutputBudgetDrafts,
  aiModelOutputBudgetSnapshot,
  type AiModelOutputBudgetDrafts,
} from "@/lib/ai-model-output-budget-form";

export { hasCustomAiModelOutputBudgets, supportsAiModelOutputBudgets } from "@/lib/ai-model-output-budget-form";

const FIELD_LABEL_KEYS: Record<AiModelOutputBudgetField, string> = {
  generationMaxOutputTokens: "aiModel.outputBudgetGeneration",
  tagSuggestionMaxOutputTokens: "aiModel.outputBudgetTagSuggestion",
  companionMaxOutputTokens: "aiModel.outputBudgetCompanion",
};

const FIELD_HINT_KEYS: Partial<Record<AiModelOutputBudgetField, string>> = {
  companionMaxOutputTokens: "aiModel.outputBudgetCompanionHint",
};

export const AiModelOutputBudgetDialog = ({ providerConfigId, model, readOnly, open, onOpenChange, onChanged }: {
  providerConfigId: string;
  model: AiModelConfig;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<unknown>;
}) => {
  const { t } = useTranslation();
  // Freeze the values seen when the dialog opened. A settings refresh while it is open
  // (for example another device saving a different field) must not turn untouched
  // fields into edits.
  const [opening] = useState(() => aiModelOutputBudgetSnapshot(model));
  const [drafts, setDrafts] = useState<AiModelOutputBudgetDrafts>(() => aiModelOutputBudgetDrafts(opening));
  const mutation = useMutation({
    mutationFn: (payload: AiModelConfigUpdateInput) => api.updateAiModel(providerConfigId, model.id, payload),
    onSuccess: async () => {
      await onChanged();
      onOpenChange(false);
    },
  });

  const { changes, invalid: invalidFields } = aiModelOutputBudgetChanges(opening, drafts);
  const invalid = invalidFields.length > 0;
  const dirty = Object.keys(changes).length > 0;

  // The parent mounts this dialog per open, so drafts always start from the saved model.
  const handleOpenChange = (next: boolean) => {
    if (!mutation.isPending) onOpenChange(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || invalid || !dirty) return;
    mutation.mutate(changes);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("aiModel.outputBudgetTitle")}</DialogTitle>
            <DialogDescription>{t("aiModel.outputBudgetDescription", { name: model.displayName })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {AI_MODEL_OUTPUT_BUDGET_FIELDS.map((field) => {
              const { min, max } = AI_MODEL_OUTPUT_BUDGET_LIMITS[field];
              const fieldInvalid = invalidFields.includes(field);
              const hintKey = FIELD_HINT_KEYS[field];
              const inputId = `ai-model-${model.id}-${field}`;
              const hintId = `${inputId}-hint`;
              return (
                <div key={field} className="grid gap-1.5 text-xs font-normal leading-5 text-slate-700">
                  <label htmlFor={inputId}>{t(FIELD_LABEL_KEYS[field])}</label>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    step={1}
                    value={drafts[field]}
                    placeholder={t("aiModel.outputBudgetDefault", { value: AI_MODEL_OUTPUT_BUDGET_DEFAULTS[field] })}
                    onChange={(event) => setDrafts((current) => ({ ...current, [field]: event.target.value }))}
                    disabled={readOnly || mutation.isPending}
                    aria-invalid={fieldInvalid}
                    aria-describedby={hintId}
                  />
                  <span id={hintId} className="grid gap-0.5 text-xs leading-4">
                    {fieldInvalid ? (
                      <span className="text-rose-600">{t("aiModel.outputBudgetInvalid", { min, max })}</span>
                    ) : (
                      <span className="text-slate-500">{t("aiModel.outputBudgetRange", { min, max })}</span>
                    )}
                    {hintKey ? <span className="text-slate-500">{t(hintKey)}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <p>{t("aiModel.outputBudgetReasoningHint")}</p>
            <p>{t("aiModel.outputBudgetScope")}</p>
          </div>
          {mutation.error ? (
            <p className="text-xs font-medium text-rose-600" role="alert">
              {aiErrorMessage(mutation.error, t("aiModel.failed"), t("aiModel.encryptionKeyMissing"), t("aiModel.savedCredentialsUnavailable"))}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:space-x-0 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={readOnly || mutation.isPending || AI_MODEL_OUTPUT_BUDGET_FIELDS.every((field) => !drafts[field].trim())}
              onClick={() => setDrafts({ generationMaxOutputTokens: "", tagSuggestionMaxOutputTokens: "", companionMaxOutputTokens: "" })}
            >
              <RotateCcw className="h-4 w-4" />{t("aiModel.outputBudgetReset")}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
              <Button type="submit" variant="solid" disabled={readOnly || mutation.isPending || invalid || !dirty}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
