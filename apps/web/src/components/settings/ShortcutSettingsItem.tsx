import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ShortcutAction, ShortcutBinding, ShortcutSettings } from "@/lib/app-helpers";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  formatShortcutBinding,
  getShortcutActionOptions,
  shortcutBindingFromKeyboardEvent,
  shortcutBindingsEqual,
} from "@/lib/app-helpers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  SETTINGS_ITEM_DESCRIPTION_CLASSNAME,
  SETTINGS_ITEM_ICON_CLASSNAME,
  SETTINGS_ITEM_TITLE_CLASSNAME,
} from "./settings-ui";

interface ShortcutSettingsItemProps {
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
}

const getConflictAction = (
  action: ShortcutAction,
  binding: ShortcutBinding,
  settings: ShortcutSettings,
  shortcutActionOptions: ReturnType<typeof getShortcutActionOptions>
) => shortcutActionOptions.find((item) => item.value !== action && shortcutBindingsEqual(settings[item.value], binding));

export const ShortcutSettingsItem = ({ shortcutSettings, onShortcutSettingsChange }: ShortcutSettingsItemProps) => {
  const { t } = useTranslation();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [captureMessage, setCaptureMessage] = useState("");
  const captureButtonRef = useRef<HTMLButtonElement | null>(null);
  const shortcutActionOptions = useMemo(() => getShortcutActionOptions(t), [t]);

  const shortcutSummary = useMemo(
    () =>
      shortcutActionOptions.map((item) => formatShortcutBinding(shortcutSettings[item.value]))
        .slice(0, 3)
        .join(" / "),
    [shortcutActionOptions, shortcutSettings]
  );

  useEffect(() => {
    if (!recordingAction) {
      return;
    }

    captureButtonRef.current?.focus();
  }, [recordingAction]);

  useEffect(() => {
    if (!recordingAction) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingAction(null);
        setCaptureMessage("");
        return;
      }

      const nextBinding = shortcutBindingFromKeyboardEvent(event);
      if (!nextBinding) {
        setCaptureMessage(t("shortcuts.requireModifier"));
        return;
      }

      const conflictAction = getConflictAction(recordingAction, nextBinding, shortcutSettings, shortcutActionOptions);
      if (conflictAction) {
        setCaptureMessage(t("shortcuts.conflict", { label: conflictAction.label }));
        return;
      }

      onShortcutSettingsChange({
        ...shortcutSettings,
        [recordingAction]: nextBinding,
      });
      setRecordingAction(null);
      setCaptureMessage("");
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onShortcutSettingsChange, recordingAction, shortcutActionOptions, shortcutSettings, t]);

  const handleResetShortcuts = () => {
    onShortcutSettingsChange(DEFAULT_SHORTCUT_SETTINGS);
    setRecordingAction(null);
    setCaptureMessage("");
  };

  return (
    <>
      <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Keyboard className={SETTINGS_ITEM_ICON_CLASSNAME} />
          <div className="min-w-0">
            <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("shortcuts.title")}</div>
            <div className={cn(SETTINGS_ITEM_DESCRIPTION_CLASSNAME, "truncate")}>{shortcutSummary}</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full bg-white px-3 text-xs sm:w-auto"
          type="button"
          onClick={() => setShortcutsOpen(true)}
        >
          {t("shortcuts.manage")}
        </Button>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-h-[min(640px,calc(100vh-2rem))] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-emerald-700" />
              {t("shortcuts.title")}
            </DialogTitle>
            <DialogDescription>{t("shortcuts.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {shortcutActionOptions.map((item) => {
              const recording = recordingAction === item.value;

              return (
                <div
                  key={item.value}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{item.label}</div>
                    <div className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{item.description}</div>
                  </div>
                  <Button
                    ref={recording ? captureButtonRef : null}
                    type="button"
                    variant={recording ? "solid" : "outline"}
                    className={cn("h-9 min-w-32 px-3 font-mono text-xs", !recording && "bg-white")}
                    onClick={() => {
                      setRecordingAction(item.value);
                      setCaptureMessage("");
                    }}
                  >
                    {recording ? t("shortcuts.recording") : formatShortcutBinding(shortcutSettings[item.value])}
                  </Button>
                </div>
              );
            })}
          </div>

          {captureMessage ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              {captureMessage}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleResetShortcuts}>
              <RotateCcw className="h-4 w-4" />
              {t("shortcuts.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
