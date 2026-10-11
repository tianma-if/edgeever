import { Check, Copy, Download, LoaderCircle, Palette, Share2, Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copyImageBlobToClipboard } from "@/lib/clipboard";
import {
  createNoteImage,
  downloadPreparedNoteImage,
  NOTE_IMAGE_CARD_WIDTH_PIXELS,
  type DownloadNoteImageOptions,
  type NoteImageCardWidth,
  type NoteImageFontSize,
  type NoteImageFontStyle,
  type NoteImageFormat,
  type NoteImageTheme,
  type PreparedNoteImage,
} from "@/lib/note-image-export";
import { NOTE_IMAGE_THEME_OPTIONS, NOTE_IMAGE_THEMES, resolveNoteImageTypography } from "@edgeever/shared/note-image-card";
import { getHtmlImageEmbedNoticeKind } from "@/lib/note-html-export";
import { cn } from "@/lib/utils";

export type ShareNoteImageSource = Omit<DownloadNoteImageOptions, "background" | "format">;

const FONT_OPTIONS: Array<{ id: NoteImageFontStyle; labelKey: string }> = [
  { id: "auto", labelKey: "editor.imageShare.fontStyles.auto" },
  { id: "sans", labelKey: "editor.imageShare.fontStyles.sans" },
  { id: "serif", labelKey: "editor.imageShare.fontStyles.serif" },
  { id: "mono", labelKey: "editor.imageShare.fontStyles.mono" },
];

const SIZE_OPTIONS: Array<{ id: NoteImageFontSize; labelKey: string }> = [
  { id: "sm", labelKey: "editor.imageShare.fontSizes.sm" },
  { id: "md", labelKey: "editor.imageShare.fontSizes.md" },
  { id: "lg", labelKey: "editor.imageShare.fontSizes.lg" },
];

const WIDTH_OPTIONS: Array<{ id: NoteImageCardWidth; labelKey: string }> = [
  { id: "compact", labelKey: "editor.imageShare.cardWidths.compact" },
  { id: "standard", labelKey: "editor.imageShare.cardWidths.standard" },
  { id: "wide", labelKey: "editor.imageShare.cardWidths.wide" },
];

export const ShareNoteImageDialog = ({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ShareNoteImageSource;
}) => {
  const { t } = useTranslation();
  const [format, setFormat] = useState<NoteImageFormat>("png");
  const [theme, setTheme] = useState<NoteImageTheme>("mint");
  const [fontStyle, setFontStyle] = useState<NoteImageFontStyle>("auto");
  const [fontSize, setFontSize] = useState<NoteImageFontSize>("lg");
  const [cardWidth, setCardWidth] = useState<NoteImageCardWidth>("wide");
  const [showTitle, setShowTitle] = useState(true);
  const [showNotebook, setShowNotebook] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [showUpdatedAt, setShowUpdatedAt] = useState(true);
  const [showReadingTime, setShowReadingTime] = useState(false);
  const [showAuthor, setShowAuthor] = useState(false);
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem("edgeever_share_author_name") || "";
    } catch {
      return "";
    }
  });
  const [showBranding, setShowBranding] = useState(true);
  const [prepared, setPrepared] = useState<PreparedNoteImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const generationRef = useRef(0);
  const copyAttemptRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setFormat("png");
    setTheme("mint");
    setFontStyle("auto");
    setFontSize("lg");
    setCardWidth("wide");
    setShowTitle(true);
    setShowNotebook(false);
    setShowTags(false);
    setShowUpdatedAt(true);
    setShowReadingTime(false);
    setShowAuthor(Boolean(author));
    setShowBranding(true);
    setCopyState("idle");
  }, [author, open, source.title]);

  useEffect(() => {
    if (!open) return;
    const generation = ++generationRef.current;
    copyAttemptRef.current += 1;
    setCopyState("idle");
    setPrepared(null);
    setError(false);
    const timer = window.setTimeout(() => {
      void createNoteImage({
        ...source,
        theme,
        background: theme,
        fontStyle,
        fontSize,
        cardWidth,
        showTitle,
        showNotebook,
        showTags,
        showUpdatedAt,
        branding: showBranding,
        author: showAuthor ? author : "",
        showAuthor,
        showReadingTime,
        format,
        notebook: showNotebook ? source.notebook : "",
        tags: showTags ? source.tags : [],
        updatedAt: showUpdatedAt ? source.updatedAt : "",
      })
        .then((result) => {
          if (generation !== generationRef.current) return;
          setPreviewUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return URL.createObjectURL(result.blob);
          });
          setPrepared(result);
        })
        .catch(() => {
          if (generation === generationRef.current) setError(true);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    author,
    cardWidth,
    fontSize,
    fontStyle,
    format,
    open,
    showAuthor,
    showBranding,
    showNotebook,
    showReadingTime,
    showTags,
    showTitle,
    showUpdatedAt,
    source,
    theme,
  ]);

  useEffect(() => () => {
    generationRef.current += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const shareFile = useMemo(
    () => (prepared ? new File([prepared.blob], prepared.filename, { type: prepared.mimeType }) : null),
    [prepared],
  );
  const canUseSystemShare = Boolean(
    shareFile && navigator.canShare?.({ files: [shareFile] }) && navigator.share,
  );
  const noticeKind = prepared ? getHtmlImageEmbedNoticeKind(prepared.images) : "none";

  const handleCopyImage = async () => {
    if (!prepared || copyState === "copying") return;
    const attempt = ++copyAttemptRef.current;
    setCopyState("copying");
    const success = await copyImageBlobToClipboard(prepared.blob);
    if (attempt !== copyAttemptRef.current) return;
    if (!success) {
      setCopyState("failed");
      return;
    }
    setCopyState("copied");
    window.setTimeout(() => {
      if (attempt !== copyAttemptRef.current) return;
      setCopyState((current) => (current === "copied" ? "idle" : current));
    }, 2000);
  };

  const share = async () => {
    if (!prepared || !shareFile) return;
    try {
      await navigator.share({ files: [shareFile], title: source.title });
      onOpenChange(false);
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError(true);
    }
  };

  const download = () => {
    if (!prepared) return;
    downloadPreparedNoteImage(prepared);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-5xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-3.5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm leading-6 font-semibold">
            <Share2 className="h-4.5 w-4.5 text-slate-700" />
            {t("editor.imageShare.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("editor.imageShare.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative flex min-h-72 flex-1 flex-col overflow-auto bg-slate-100/90 md:max-h-[75vh]">
            <div className="flex min-h-full w-full flex-col items-center justify-start p-4 sm:p-6">
              {previewUrl && prepared ? (
                <div className="my-auto flex w-full items-center justify-center transition-all duration-150">
                  <img
                    alt={t("editor.imageShare.previewAlt")}
                    className="block rounded-xl shadow-xl transition-all duration-150"
                    style={{
                      width: `${NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || 800}px`,
                      maxWidth: "100%",
                      height: "auto",
                    }}
                    src={previewUrl}
                  />
                </div>
              ) : error ? (
                <div className="my-auto flex min-h-64 items-center justify-center text-xs leading-5 text-rose-600" role="alert">
                  {t("editor.imageExport.error")}
                </div>
              ) : (
                <div className="my-auto flex min-h-64 items-center justify-center gap-2 text-xs leading-5 text-slate-500" role="status">
                  <LoaderCircle className="h-5 w-5 animate-spin text-slate-500" />
                  {t("editor.imageShare.generating")}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5 overflow-y-auto border-t border-slate-200 p-5 md:max-h-[72vh] md:border-l md:border-t-0">
            {/* Theme Selector */}
            <fieldset className="space-y-2.5">
              <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Palette className="h-3.5 w-3.5" />
                {t("editor.imageShare.theme")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {NOTE_IMAGE_THEME_OPTIONS.map((id) => {
                  const isSelected = theme === id;
                  const label = t(`editor.imageShare.themes.${id}`);
                  const style = NOTE_IMAGE_THEMES[id];
                  const typography = resolveNoteImageTypography(id, fontStyle);
                  return (
                    <button
                      key={id}
                      aria-pressed={isSelected}
                      className={cn(
                        "group relative flex flex-col items-stretch gap-2 rounded-lg border p-2 text-left text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                        isSelected
                          ? "border-slate-900 bg-slate-50 text-slate-950 ring-1 ring-slate-900"
                          : "border-slate-200 bg-card text-slate-700 hover:border-slate-300 hover:bg-slate-50/70",
                      )}
                      type="button"
                      onClick={() => setTheme(id)}
                    >
                      <span aria-hidden="true" className="block rounded p-2" style={{ background: style.canvasBg }}>
                        <span className="block rounded-sm border p-2" style={{ background: style.cardBg, border: style.cardBorder, color: style.textColor, fontFamily: typography.bodyFamily }}>
                          <span className="block truncate text-[11px]" style={{ color: style.headingColor, fontFamily: typography.headingFamily, fontWeight: typography.headingWeight }}>{source.title || label}</span>
                          <span className="mt-1 block truncate text-[9px]">{t("editor.imageShare.previewBody")}</span>
                          <span className="mt-1 block truncate border-l-2 pl-1 text-[9px]" style={{ borderColor: style.quoteBorder, background: style.quoteBg }}>{t("editor.imageShare.previewQuote")}</span>
                        </span>
                      </span>
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Typography and Layout */}
            <fieldset className="space-y-3">
              <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Type className="h-3.5 w-3.5" />
                {t("editor.imageShare.fontStyle")}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={fontStyle === item.id}
                    className={cn(
                      "h-8 rounded-md border text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                      fontStyle === item.id
                        ? "border-slate-900 bg-slate-100 text-slate-950 font-semibold"
                        : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50",
                    )}
                    type="button"
                    onClick={() => setFontStyle(item.id)}
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>

              {/* Font Size */}
              <div className="space-y-1.5 pt-1">
                <div className="text-xs font-medium text-slate-600">{t("editor.imageShare.fontSize")}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SIZE_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={fontSize === item.id}
                      className={cn(
                        "h-7 rounded border text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                        fontSize === item.id
                          ? "border-slate-900 bg-slate-100 text-slate-950 font-semibold"
                          : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50",
                      )}
                      type="button"
                      onClick={() => setFontSize(item.id)}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Card Width */}
              <div className="space-y-1.5 pt-1">
                <div className="text-xs font-medium text-slate-600">{t("editor.imageShare.cardWidth")}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {WIDTH_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      aria-pressed={cardWidth === item.id}
                      className={cn(
                        "h-7 rounded border text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                        cardWidth === item.id
                          ? "border-slate-900 bg-slate-100 text-slate-950 font-semibold"
                          : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50",
                      )}
                      type="button"
                      onClick={() => setCardWidth(item.id)}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>

            {/* Metadata / Content Toggles */}
            <fieldset className="space-y-2.5">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {t("editor.imageShare.metadata")}
              </legend>
              <div className="space-y-2">
                {([
                  ["title", showTitle, setShowTitle],
                  ["notebook", showNotebook, setShowNotebook],
                  ["tags", showTags, setShowTags],
                  ["updatedAt", showUpdatedAt, setShowUpdatedAt],
                  ["readingTime", showReadingTime, setShowReadingTime],
                  ["author", showAuthor, setShowAuthor],
                  ["branding", showBranding, setShowBranding],
                ] as const).map(([key, checked, setChecked]) => (
                  <div key={key} className="space-y-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
                      {t(`editor.imageShare.fields.${key}`)}
                    </label>
                    {key === "author" && showAuthor && (
                      <div className="pl-6">
                        <input
                          type="text"
                          value={author}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAuthor(val);
                            try {
                              localStorage.setItem("edgeever_share_author_name", val);
                            } catch {
                              // Ignore localStorage error
                            }
                          }}
                          placeholder={t("editor.imageShare.authorPlaceholder")}
                          className="h-7 w-full rounded border border-slate-300 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                          maxLength={32}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Format Selection */}
            <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("editor.imageShare.format")}
              <Select value={format} onValueChange={(value) => setFormat(value as NoteImageFormat)}>
                <SelectTrigger className="h-8 text-xs font-normal normal-case tracking-normal text-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="text-xs" value="png">
                    PNG · {t("editor.imageShare.pngHint")}
                  </SelectItem>
                  <SelectItem className="text-xs" value="jpeg">
                    JPEG · {t("editor.imageShare.jpegHint")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            {noticeKind !== "none" ? (
              <p className="text-xs leading-5 text-amber-700">
                {t(
                  noticeKind === "partial"
                    ? "editor.imageExport.imageEmbedPartial"
                    : "editor.imageExport.imageEmbedFailed",
                  prepared?.images,
                )}
              </p>
            ) : null}
          </div>
        </div>

        {copyState === "failed" ? (
          <p className="border-t border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700" role="alert">
            {t("editor.imageShare.copyFailed")}
          </p>
        ) : null}
        <DialogFooter className="border-t border-slate-200 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!prepared || copyState === "copying"}
            onClick={() => void handleCopyImage()}
          >
            {copyState === "copied" ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" />
                <span className="text-emerald-700">{t("editor.imageShare.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                {t("editor.imageShare.copyImage")}
              </>
            )}
          </Button>
          <Button
            variant={canUseSystemShare ? "outline" : "solid"}
            size="sm"
            disabled={!prepared}
            onClick={download}
          >
            <Download className="h-4 w-4" />
            {t("editor.imageShare.download")}
          </Button>
          {canUseSystemShare ? (
            <Button variant="solid" size="sm" disabled={!prepared} onClick={() => void share()}>
              <Share2 className="h-4 w-4" />
              {t("editor.imageShare.share")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
