import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ShortcutAction, ShortcutBinding, ShortcutSettings } from "@/lib/app-helpers";
import {
  getDefaultShortcutSettings,
  formatShortcutBinding,
  getShortcutActionOptions,
  getShortcutActionForEvent,
  resolvedShortcutModifiers,
  shortcutBindingFromKeyboardEvent,
  shortcutBindingsEqual,
} from "@/lib/app-helpers";
import { Button } from "@/components/ui/button";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { cn } from "@/lib/utils";
import { SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";

interface ShortcutSettingsItemProps {
  shortcutSettings: ShortcutSettings;
  onShortcutSettingsChange: (settings: ShortcutSettings) => void;
}

type GlobalShortcutTarget = "window" | "screenshot";

const getConflictAction = (
  action: ShortcutAction,
  binding: ShortcutBinding,
  settings: ShortcutSettings,
  shortcutActionOptions: ReturnType<typeof getShortcutActionOptions>
) => shortcutActionOptions.find((item) => item.value !== action && shortcutBindingsEqual(settings[item.value], binding));

const globalBindingFromEvent = (event: KeyboardEvent): DesktopGlobalShortcutBinding | null => {
  const key = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase()
    ?? /^Digit([0-9])$/.exec(event.code)?.[1]
    ?? (/^F(?:[1-9]|1[0-2])$/.test(event.key) ? event.key.toLowerCase() : null);
  if (!key || [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey].filter(Boolean).length < 2) return null;
  return { key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey };
};

const formatGlobalBinding = (binding: DesktopGlobalShortcutBinding) => {
  const isMac = /mac/i.test(window.navigator.platform);
  const parts = [
    binding.ctrl && (isMac ? "⌃" : "Ctrl"),
    binding.meta && (isMac ? "⌘" : "Meta"),
    binding.alt && (isMac ? "⌥" : "Alt"),
    binding.shift && (isMac ? "⇧" : "Shift"),
    binding.key.toUpperCase(),
  ].filter(Boolean);
  return parts.join(isMac ? "" : " + ");
};

const globalBindingsEqual = (left: DesktopGlobalShortcutBinding | null | undefined, right: DesktopGlobalShortcutBinding | null | undefined) => Boolean(
  left && right
  && left.key === right.key
  && left.ctrl === right.ctrl
  && left.meta === right.meta
  && left.alt === right.alt
  && left.shift === right.shift
);

const globalBindingMatchesLocal = (global: DesktopGlobalShortcutBinding, local: ShortcutBinding) => {
  const modifiers = resolvedShortcutModifiers(local);
  return global.key === local.key
    && global.ctrl === modifiers.ctrl
    && global.meta === modifiers.meta
    && global.alt === local.alt
    && global.shift === local.shift;
};

const devPreviewGlobalShortcutState = (): DesktopGlobalShortcutState | null => (
  import.meta.env.DEV && typeof window !== "undefined" && !window.edgeeverDesktop?.globalShortcut
    ? { binding: null, registered: false, screenshot: null, screenshotRegistered: false }
    : null
);

export const ShortcutSettingsItem = ({ shortcutSettings, onShortcutSettingsChange }: ShortcutSettingsItemProps) => {
  const { t } = useTranslation();
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [captureMessage, setCaptureMessage] = useState("");
  const [globalShortcut, setGlobalShortcut] = useState<DesktopGlobalShortcutState | null>(devPreviewGlobalShortcutState);
  const [recordingTarget, setRecordingTarget] = useState<GlobalShortcutTarget | null>(null);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const captureButtonRef = useRef<HTMLButtonElement | null>(null);
  const shortcutActionOptions = useMemo(() => getShortcutActionOptions(t), [t]);

  useEffect(() => {
    let active = true;
    if (window.edgeeverDesktop?.globalShortcut) {
      void window.edgeeverDesktop.globalShortcut().then((state) => {
        if (active) setGlobalShortcut(state);
      }).catch(() => {
        if (active) setGlobalMessage(t("shortcuts.global.saveFailed"));
      });
    }
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => { void window.edgeeverDesktop?.captureGlobalShortcut(false); }, []);

  const beginRecording = async (action: ShortcutAction | GlobalShortcutTarget) => {
    try {
      if (window.edgeeverDesktop?.captureGlobalShortcut) {
        await window.edgeeverDesktop.captureGlobalShortcut(true);
      }
      if (action === "window" || action === "screenshot") {
        setRecordingTarget(action);
        setGlobalMessage("");
      } else {
        setRecordingAction(action);
        setCaptureMessage("");
      }
    } catch {
      setGlobalMessage(t("shortcuts.global.unavailable"));
    }
  };

  const finishRecording = () => {
    setRecordingAction(null);
    setRecordingTarget(null);
    void window.edgeeverDesktop?.captureGlobalShortcut(false);
  };

  useEffect(() => {
    if (!recordingTarget) return;
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        finishRecording();
        setGlobalMessage("");
        return;
      }
      const binding = globalBindingFromEvent(event);
      if (!binding) {
        setGlobalMessage(t("shortcuts.global.requireModifiers"));
        return;
      }
      const otherBinding = recordingTarget === "screenshot" ? globalShortcut?.binding : globalShortcut?.screenshot;
      const otherLabel = recordingTarget === "screenshot" ? t("shortcuts.global.label") : t("shortcuts.screenshot.label");
      if (globalBindingsEqual(binding, otherBinding)) {
        setGlobalMessage(t("shortcuts.conflict", { label: otherLabel }));
        return;
      }
      const conflict = getShortcutActionForEvent(event, shortcutSettings);
      if (conflict) {
        const label = shortcutActionOptions.find((item) => item.value === conflict)?.label ?? conflict;
        setGlobalMessage(t("shortcuts.conflict", { label }));
        return;
      }
      const target = recordingTarget;
      finishRecording();
      setGlobalBusy(true);
      void (async () => {
        if (window.edgeeverDesktop?.captureGlobalShortcut) {
          await window.edgeeverDesktop.captureGlobalShortcut(false);
        }
        const setter = target === "screenshot" ? window.edgeeverDesktop?.setScreenshotShortcut : window.edgeeverDesktop?.setGlobalShortcut;
        if (setter) {
          const state = await setter(binding);
          if (state) {
            setGlobalShortcut(state);
            setGlobalMessage(state.error ? t(`shortcuts.global.${state.error}`) : "");
          }
        } else if (import.meta.env.DEV) {
          setGlobalShortcut((prev) => ({
            binding: target === "window" ? binding : (prev?.binding ?? null),
            registered: true,
            screenshot: target === "screenshot" ? binding : (prev?.screenshot ?? null),
            screenshotRegistered: true,
          }));
        }
      })().catch(() => setGlobalMessage(t("shortcuts.global.saveFailed"))).finally(() => setGlobalBusy(false));
    };
    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, [globalShortcut, recordingTarget, shortcutActionOptions, shortcutSettings, t]);

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
        finishRecording();
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
      if (globalShortcut?.binding && globalBindingMatchesLocal(globalShortcut.binding, nextBinding)) {
        setCaptureMessage(t("shortcuts.conflict", { label: t("shortcuts.global.label") }));
        return;
      }
      if (globalShortcut?.screenshot && globalBindingMatchesLocal(globalShortcut.screenshot, nextBinding)) {
        setCaptureMessage(t("shortcuts.conflict", { label: t("shortcuts.screenshot.label") }));
        return;
      }

      onShortcutSettingsChange({
        ...shortcutSettings,
        [recordingAction]: nextBinding,
      });
      finishRecording();
      setCaptureMessage("");
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [globalShortcut, onShortcutSettingsChange, recordingAction, shortcutActionOptions, shortcutSettings, t]);

  const handleResetShortcuts = () => {
    onShortcutSettingsChange(getDefaultShortcutSettings());
    finishRecording();
    setCaptureMessage("");
  };

  const disableGlobalShortcut = (target: GlobalShortcutTarget) => {
    setGlobalBusy(true);
    const setter = target === "screenshot" ? window.edgeeverDesktop?.setScreenshotShortcut : window.edgeeverDesktop?.setGlobalShortcut;
    if (setter) {
      void setter(null).then((state) => {
        if (state) {
          setGlobalShortcut(state);
          setGlobalMessage(state.error ? t(`shortcuts.global.${state.error}`) : "");
        }
      }).catch(() => setGlobalMessage(t("shortcuts.global.saveFailed"))).finally(() => setGlobalBusy(false));
    } else if (import.meta.env.DEV) {
      setGlobalShortcut((prev) => ({
        binding: target === "window" ? null : (prev?.binding ?? null),
        registered: target === "window" ? false : Boolean(prev?.registered),
        screenshot: target === "screenshot" ? null : (prev?.screenshot ?? null),
        screenshotRegistered: target === "screenshot" ? false : Boolean(prev?.screenshotRegistered),
      }));
      setGlobalBusy(false);
    }
  };

  const globalRows: Array<{
    target: GlobalShortcutTarget;
    label: string;
    binding: DesktopGlobalShortcutBinding | null | undefined;
    registered: boolean;
  }> = [
    {
      target: "window",
      label: t("shortcuts.global.label"),
      binding: globalShortcut?.binding,
      registered: Boolean(globalShortcut?.registered),
    },
    {
      target: "screenshot",
      label: t("shortcuts.screenshot.label"),
      binding: globalShortcut?.screenshot,
      registered: Boolean(globalShortcut?.screenshotRegistered),
    },
  ];

  const hasUnregisteredGlobal = globalRows.some((row) => row.binding && !row.registered);
  const isGlobalShortcutAvailable = Boolean(window.edgeeverDesktop?.isAvailable || import.meta.env.DEV);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-card">
      {isGlobalShortcutAvailable ? (
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
          <span className="text-xs font-medium text-slate-700">{t("shortcuts.appSectionTitle")}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
        {shortcutActionOptions.map((item, index) => {
          const recording = recordingAction === item.value;
          const lastAlone = index === shortcutActionOptions.length - 1 && shortcutActionOptions.length % 2 === 1;

          return (
            <div
              key={item.value}
              className={cn(
                "flex h-12 items-center justify-between gap-3 bg-card px-4",
                lastAlone && "sm:col-span-2",
              )}
            >
              <div className={cn("min-w-0 truncate", SETTINGS_ITEM_TITLE_CLASSNAME)}>{item.label}</div>
              <Button
                ref={recording ? captureButtonRef : null}
                type="button"
                variant={recording ? "solid" : "outline"}
                className={cn("h-8 min-w-24 shrink-0 px-3 font-mono text-xs font-normal", !recording && "bg-card")}
                onClick={() => { void beginRecording(item.value); }}
                disabled={Boolean(recordingTarget) || globalBusy}
              >
                {recording ? t("shortcuts.recording") : formatShortcutBinding(shortcutSettings[item.value])}
              </Button>
            </div>
          );
        })}
      </div>
      {captureMessage ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
          {captureMessage}
        </div>
      ) : null}

      {isGlobalShortcutAvailable ? (
        <div>
          <div className="border-b border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
            <span className="text-xs font-medium text-slate-700">{t("shortcuts.globalSectionTitle")}</span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
            {globalRows.map((row) => {
              const recording = recordingTarget === row.target;
              return (
                <div
                  key={row.target}
                  className="flex h-12 items-center justify-between gap-3 bg-card px-4"
                >
                  <div className={cn("min-w-0 truncate", SETTINGS_ITEM_TITLE_CLASSNAME)}>{row.label}</div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant={recording ? "solid" : "outline"}
                      className={cn(
                        "h-8 min-w-24 shrink-0 px-3 font-mono text-xs font-normal",
                        !recording && "bg-card",
                      )}
                      disabled={!globalShortcut || globalBusy || Boolean(recordingAction) || (Boolean(recordingTarget) && !recording)}
                      onClick={() => { void beginRecording(row.target); }}
                    >
                      {recording ? t("shortcuts.recording") : row.binding ? formatGlobalBinding(row.binding) : t("shortcuts.global.disabled")}
                    </Button>
                    {row.binding ? (
                      <ButtonTooltip title={t("shortcuts.global.disable")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          aria-label={t("shortcuts.global.disable")}
                          disabled={globalBusy || Boolean(recordingTarget) || Boolean(recordingAction)}
                          onClick={() => disableGlobalShortcut(row.target)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </ButtonTooltip>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {globalMessage ? (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
              {globalMessage}
            </div>
          ) : hasUnregisteredGlobal ? (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700">
              {t("shortcuts.global.unavailable")}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end border-t border-slate-100 px-4 py-3">
        <Button type="button" variant="outline" className="h-9 px-3 text-xs font-normal" onClick={handleResetShortcuts}>
          <RotateCcw className="h-4 w-4" />
          {t("shortcuts.reset")}
        </Button>
      </div>
    </div>
  );
};
