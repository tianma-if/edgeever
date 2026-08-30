import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { EditorSavePhase } from "./useEditorSaveStatus";

export const EditorSaveRecoveryBanner = ({
  saveState,
  conflictReason,
  storageSaveError,
  savePending,
  actionPending,
  actionMessage,
  onAdoptCloud,
  onCopyDraft,
  onRetry,
}: {
  saveState: EditorSavePhase;
  conflictReason: string | null;
  storageSaveError: boolean;
  savePending: boolean;
  actionPending: "adopt" | "copy" | null;
  actionMessage: string | null;
  onAdoptCloud: () => Promise<void> | void;
  onCopyDraft: () => Promise<void> | void;
  onRetry: () => void;
}) => {
  const { t } = useTranslation();
  const message = saveState === "conflict" && conflictReason
    ? conflictReason
    : saveState === "error" && storageSaveError
      ? t("editor.saveState.storageUnavailable")
      : null;

  if (!message) return null;
  const isConflict = saveState === "conflict";

  return (
    <div className="flex flex-col gap-2 border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800 sm:px-5" role="alert">
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{message}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5">
        <Button
          size="sm"
          variant="solid"
          className="h-7 bg-rose-700 px-2.5 text-[11px] text-white hover:bg-rose-800"
          disabled={isConflict ? actionPending !== null : savePending}
          onClick={() => { if (isConflict) void onAdoptCloud(); else onRetry(); }}
        >
          {isConflict
            ? actionPending === "adopt"
              ? t("editor.saveState.conflictAdopting")
              : t("editor.saveState.conflictAdoptCloud")
            : t("editor.saveState.storageRetry")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-[11px] text-rose-800 hover:bg-rose-100"
          disabled={actionPending !== null}
          onClick={() => void onCopyDraft()}
        >
          {t("editor.saveState.conflictCopyDraft")}
        </Button>
        {actionMessage ? (
          <span className="text-[11px] font-medium text-rose-700" role="status" aria-live="polite">
            {actionMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
};
