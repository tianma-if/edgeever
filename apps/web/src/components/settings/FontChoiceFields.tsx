import { LEGACY_BODY_FONTS } from "@edgeever/shared/font-resources";
import type { BodyFontId } from "@edgeever/shared/font-loader";
import { useFontPreviewStatus } from "@/lib/use-font-preview-status";
import { FONT_CATALOG, NOTE_BODY_FONT_MENU_GROUPS, isRemoteNoteImageFont, type RemoteNoteImageFont } from "@edgeever/shared/font-catalog";
import { FontLoadFeedback } from "@/components/FontLoadFeedback";
import { editorFontLoadState, uiFontLoadState, retryEditorCatalogFont, retryUiCatalogFont } from "@/lib/editor-catalog-fonts";
import { FontLabel } from "@/components/FontLabel";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getFontChoicePreviewStack, type EditorBodyFontChoice, type EditorBodyFontPreference } from "@/lib/editor-body-font";

const CUSTOM_FONT_SUGGESTIONS = [
  { label: "苹方 (PingFang SC)", family: "PingFang SC" },
  { label: "微软雅黑 (Microsoft YaHei)", family: "Microsoft YaHei" },
  { label: "鸿蒙黑体 (HarmonyOS)", family: "HarmonyOS Sans SC" },
  { label: "冬青黑体 (Hiragino)", family: "Hiragino Sans GB" },
] as const;

const LEGACY_NOTE_BODY_MENU_KEYS = {
  "wenkai-screen": "wenkaiScreen",
  "neo-zhi-song": "neoZhiSong",
  "source-serif": "sourceSerif",
} as const;

type LegacyNoteBodyMenuId = keyof typeof LEGACY_NOTE_BODY_MENU_KEYS;

const isLegacyNoteBodyMenuId = (id: string): id is LegacyNoteBodyMenuId => Object.hasOwn(LEGACY_NOTE_BODY_MENU_KEYS, id);

const noteBodyChineseMenuIds = (legacyChoice: LegacyNoteBodyMenuId | null) => [
  ...NOTE_BODY_FONT_MENU_GROUPS.chineseReading.flatMap((id) =>
    (id === "wenkai" && legacyChoice === "wenkai-screen") || (id === "source-han-serif" && legacyChoice === "neo-zhi-song")
      ? [id, legacyChoice]
      : [id],
  ),
  ...NOTE_BODY_FONT_MENU_GROUPS.chineseDisplay,
];

const noteBodyLatinMenuIds = (legacyChoice: LegacyNoteBodyMenuId | null) => [
  ...(legacyChoice === "source-serif" ? [legacyChoice] : []),
  ...NOTE_BODY_FONT_MENU_GROUPS.latin,
];

export const FontChoiceFields = ({
  label,
  preference,
  onChange,
  scope,
}: {
  scope: "ui" | "editor";
  label: string;
  preference: EditorBodyFontPreference;
  onChange: (preference: EditorBodyFontPreference) => void;
}) => {
  const { t } = useTranslation();
  const [fontOpen, setFontOpen] = useState(false);
  const [fontRetry, setFontRetry] = useState(0);
  const loadState = scope === "editor" ? editorFontLoadState : uiFontLoadState;
  const bodyStatus = useSyncExternalStore(loadState.subscribe, loadState.getSnapshot, loadState.getSnapshot);
  const catalogSelected = isRemoteNoteImageFont(preference.choice) || preference.choice in LEGACY_BODY_FONTS;
  const selectedLabel = isRemoteNoteImageFont(preference.choice) ? t(FONT_CATALOG[preference.choice].labelKey) : t(`settings.editorBodyFonts.${preference.choice === "wenkai-screen" ? "wenkaiScreen" : preference.choice === "neo-zhi-song" ? "neoZhiSong" : "sourceSerif"}`);
  const { status: selectedStatus, onPreviewStatus } = useFontPreviewStatus(`${preference.choice}:${fontRetry}`, bodyStatus === "idle" ? "loading" : bodyStatus);
  const legacyMenuChoice = isLegacyNoteBodyMenuId(preference.choice) ? preference.choice : null;
  const catalogFontItem = (id: RemoteNoteImageFont) => (
    <SelectItem key={id} value={id} textValue={t(FONT_CATALOG[id].labelKey)}>
      <FontLabel label={t(FONT_CATALOG[id].labelKey)} fontId={id} enabled={fontOpen} visibleOnly />
    </SelectItem>
  );
  const noteBodyFontItem = (id: RemoteNoteImageFont | LegacyNoteBodyMenuId) => {
    if (!isLegacyNoteBodyMenuId(id)) return catalogFontItem(id);
    const label = t(`settings.editorBodyFonts.${LEGACY_NOTE_BODY_MENU_KEYS[id]}`);
    return (
      <SelectItem key={id} value={id} textValue={label} style={{ fontFamily: getFontChoicePreviewStack(id) }}>
        {label}
      </SelectItem>
    );
  };
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80">
      <Select
        value={preference.choice}
        onOpenChange={setFontOpen}
        onValueChange={(value) => onChange({ choice: value as EditorBodyFontChoice, customFamily: preference.customFamily })}
      >
        <SelectTrigger aria-label={label} className="h-9 bg-card">
          <SelectValue>{catalogSelected ? <FontLabel label={selectedLabel} fontId={preference.choice as BodyFontId} enabled onStatusChange={onPreviewStatus} status={selectedStatus} retryKey={fontRetry} /> : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="system">{t("settings.editorBodyFonts.system")}</SelectItem>
          {noteBodyChineseMenuIds(legacyMenuChoice).map(noteBodyFontItem)}
          <SelectSeparator />
          {noteBodyLatinMenuIds(legacyMenuChoice).map(noteBodyFontItem)}
          <SelectItem value="custom">{t("settings.editorBodyFonts.custom")}</SelectItem>
        </SelectContent>
      </Select>
      {catalogSelected ? <FontLoadFeedback status={selectedStatus} onRetry={() => { setFontRetry(value => value + 1); (scope === "editor" ? retryEditorCatalogFont : retryUiCatalogFont)(); }} /> : null}
      {preference.choice === "custom" ? (
        <div className="flex flex-col gap-1.5">
          <Input
            value={preference.customFamily}
            aria-label={t("settings.editorBodyFontCustomLabel")}
            placeholder={t("settings.editorBodyFontCustomPlaceholder")}
            className="h-9"
            maxLength={200}
            onChange={(event) => onChange({ choice: "custom", customFamily: event.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            <span className="shrink-0 text-slate-400">{t("settings.editorBodyFontSuggestions")}:</span>
            {CUSTOM_FONT_SUGGESTIONS.map((item) => (
              <button
                key={item.family}
                type="button"
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => onChange({ choice: "custom", customFamily: item.family })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

