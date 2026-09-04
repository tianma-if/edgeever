import { useEffect, useRef, useState } from "react";
import { Download, Moon, RotateCcw, Sun, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import {
  CustomEditorThemeFileError,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  DEFAULT_CUSTOM_DARK_COLORS,
  MAX_CUSTOM_EDITOR_THEME_FILE_BYTES,
  customEditorThemeFileName,
  getEditorThemeContrastIssues,
  isValidThemeColors,
  parseCustomEditorThemeFile,
  serializeCustomEditorTheme,
  type CustomEditorTheme,
  type ThemeColors,
} from "@/lib/custom-editor-theme";

interface CustomEditorThemeDialogProps {
  open: boolean;
  theme: CustomEditorTheme;
  onOpenChange: (open: boolean) => void;
  onSave: (theme: CustomEditorTheme) => void;
  onDelete?: (id: string) => void;
  isDefaultTheme?: boolean;
}

const COLOR_FIELDS = [
  ["background", "settings.customEditorTheme.background"],
  ["text", "settings.customEditorTheme.text"],
  ["muted", "settings.customEditorTheme.muted"],
  ["heading", "settings.customEditorTheme.heading"],
  ["accent", "settings.customEditorTheme.accent"],
  ["soft", "settings.customEditorTheme.soft"],
  ["codeBackground", "settings.customEditorTheme.codeBackground"],
  ["border", "settings.customEditorTheme.border"],
] as const;

export const CustomEditorThemeDialog = ({
  open,
  theme,
  onOpenChange,
  onSave,
  onDelete,
  isDefaultTheme = false,
}: CustomEditorThemeDialogProps) => {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CustomEditorTheme>(theme);
  const [activeMode, setActiveMode] = useState<"light" | "dark">("light");
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(theme);
      setActiveMode("light");
      setImportError(null);
    }
  }, [open, theme]);

  const updateName = (name: string) => setDraft((current) => ({ ...current, name }));

  const updateColor = (key: keyof ThemeColors, value: string) => {
    setDraft((current) => ({
      ...current,
      [activeMode]: {
        ...current[activeMode],
        [key]: value,
      },
    }));
  };

  const activeColors = draft[activeMode] || DEFAULT_CUSTOM_LIGHT_COLORS;
  const defaultColors = activeMode === "light" ? DEFAULT_CUSTOM_LIGHT_COLORS : DEFAULT_CUSTOM_DARK_COLORS;

  const valid =
    draft.name.trim().length > 0 &&
    isValidThemeColors(draft.light) &&
    isValidThemeColors(draft.dark);
  const lightContrastIssues = isValidThemeColors(draft.light) ? getEditorThemeContrastIssues(draft.light) : [];
  const darkContrastIssues = isValidThemeColors(draft.dark) ? getEditorThemeContrastIssues(draft.dark) : [];
  const activeContrastIssues = activeMode === "light" ? lightContrastIssues : darkContrastIssues;

  const describeImportError = (error: unknown) => {
    if (error instanceof CustomEditorThemeFileError) {
      return t(`settings.customEditorTheme.importErrors.${error.code}`);
    }
    return t("settings.customEditorTheme.importErrors.invalidFile");
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      if (file.size > MAX_CUSTOM_EDITOR_THEME_FILE_BYTES) {
        throw new CustomEditorThemeFileError("fileTooLarge", "Editor theme file is too large.");
      }
      const imported = parseCustomEditorThemeFile(await file.text());
      setDraft({ id: `custom-${crypto.randomUUID()}`, ...imported });
      setActiveMode("light");
    } catch (error) {
      setImportError(describeImportError(error));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = () => {
    const url = URL.createObjectURL(new Blob([serializeCustomEditorTheme(draft)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = customEditorThemeFileName(draft.name);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleReset = () => {
    setDraft((current) => ({
      ...current,
      light: DEFAULT_CUSTOM_LIGHT_COLORS,
      dark: DEFAULT_CUSTOM_DARK_COLORS,
      customCss: "",
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] sm:max-w-[500px] max-h-[95vh] overflow-y-auto p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">{t("settings.customEditorTheme.title")}</DialogTitle>
          <DialogDescription className="text-xs">{t("settings.customEditorTheme.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 mt-1.5">
          {/* Theme Name */}
          <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-700">
            <span>{t("settings.customEditorTheme.name")}</span>
            <Input
              value={draft.name}
              onChange={(event) => updateName(event.target.value)}
              maxLength={32}
              className="h-8 max-w-[240px] text-xs"
            />
          </div>

          {/* Mode Switcher */}
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setActiveMode("light")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-all ${
                activeMode === "light"
                  ? "bg-white text-emerald-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              {t("settings.themeToggleToLight")}
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("dark")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-all ${
                activeMode === "dark"
                  ? "bg-white text-emerald-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              {t("settings.themeToggleToDark")}
            </button>
          </div>

          {/* Color Matrix */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {COLOR_FIELDS.map(([key, labelKey]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-xs font-medium text-slate-700">
                <span className="truncate">{t(labelKey)}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(activeColors[key]) ? activeColors[key] : defaultColors[key]}
                    onChange={(event) => updateColor(key as keyof ThemeColors, event.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                    aria-label={t(labelKey)}
                  />
                  <Input
                    value={activeColors[key]}
                    aria-label={t(labelKey)}
                    onChange={(event) => updateColor(key as keyof ThemeColors, event.target.value)}
                    maxLength={7}
                    className="h-7 w-20 px-1.5 font-mono text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>
          {activeContrastIssues.length > 0 ? (
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">
              {t("settings.customEditorTheme.contrastWarning", {
                mode: t(`settings.customEditorTheme.modes.${activeMode}`),
                fields: new Intl.ListFormat(i18n.resolvedLanguage ?? i18n.language, { type: "conjunction" })
                  .format(activeContrastIssues.map((field) => t(`settings.customEditorTheme.${field}`))),
              })}
            </p>
          ) : null}
          {importError ? <p className="rounded-md bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700" role="alert">{importError}</p> : null}

          {/* Custom CSS Textarea */}
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            {t("settings.customEditorTheme.customCss", "Custom CSS (高级自定义样式表)")}
            <textarea
              value={draft.customCss || ""}
              onChange={(event) => setDraft((current) => ({ ...current, customCss: event.target.value }))}
              placeholder="e.g. h1 { font-style: italic; } blockquote { border-radius: 6px; }"
              className="min-h-[72px] w-full rounded-md border border-slate-200 bg-white p-2 font-mono text-[11px] focus:border-emerald-500 focus:outline-none"
              maxLength={2000}
            />
          </label>

          {/* Preview Panel */}
          <div
            className="edgeever-editor rounded-lg border transition-all"
            style={{
              backgroundColor: activeColors.background,
              borderColor: activeColors.border,
            }}
          >
            <div
              className="ProseMirror p-3 text-xs leading-6"
              style={{
                color: activeColors.text,
                padding: "0.75rem",
              }}
            >
              {draft.customCss && (
                <style dangerouslySetInnerHTML={{ __html: sanitizeAndScopeCss(draft.customCss) }} />
              )}
              <div className="text-sm font-semibold mb-0.5" style={{ color: activeColors.heading }}>
                {t("settings.customEditorTheme.previewTitle")}
              </div>
              <p className="mb-0.5">{t("settings.customEditorTheme.previewBody")}</p>
              <p className="mb-0.5" style={{ color: activeColors.muted }}>
                {t("settings.customEditorTheme.previewMuted")}
              </p>
              <strong style={{ color: activeColors.accent }}>
                {t("settings.customEditorTheme.previewAccent")}
              </strong>
              <blockquote
                style={{
                  background: activeColors.soft,
                  color: activeColors.muted,
                  borderColor: activeColors.accent,
                  margin: "0.75rem 0 0",
                  padding: "0.8rem 1rem",
                }}
              >
                <p>{t("settings.customEditorTheme.previewQuote")}</p>
                <pre
                  style={{
                    background: activeColors.codeBackground,
                    color: activeColors.text,
                    borderColor: activeColors.border,
                    marginBottom: 0,
                  }}
                >
                  <code style={{ background: "transparent", color: "inherit" }}>{'const message = "Hello, EdgeEver!";'}</code>
                </pre>
              </blockquote>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0 mt-3 pt-2 border-t border-slate-100">
          <div className="flex flex-1 gap-2">
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-slate-500 hover:text-slate-800" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {t("settings.customEditorTheme.reset")}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-slate-500 hover:text-slate-800" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              {t("settings.customEditorTheme.import")}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs text-slate-500 hover:text-slate-800" disabled={!valid} onClick={handleExport}>
              <Download className="h-3.5 w-3.5 mr-1" />
              {t("settings.customEditorTheme.export")}
            </Button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            {onDelete && !isDefaultTheme && (
              <Button
                variant="danger"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  onDelete(draft.id);
                  onOpenChange(false);
                }}
              >
                {t("common.delete")}
              </Button>
            )}
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!valid}
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                onSave({ ...draft, name: draft.name.trim() });
                onOpenChange(false);
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
