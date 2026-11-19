import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  Compass,
  GitFork,
  Layers,
  Milestone,
  Network,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAppearanceTheme } from "./ThemeProvider";
import { infographicPreviewSyntax, infographicUsesDarkSheet } from "@/lib/infographic-preview-theme";
import {
  INFOGRAPHIC_SAMPLE_CATEGORIES,
  INFOGRAPHIC_SAMPLES,
  getSampleDesc,
  getSampleSyntax,
  getSampleTitle,
  type InfographicSample,
  type InfographicSampleCategory,
} from "@/lib/infographic-samples";
import { cn } from "@/lib/utils";

type Props = {
  onSelect: (sample: InfographicSample, syntax: string, title: string) => void;
  readOnly?: boolean;
  className?: string;
  isDialog?: boolean;
};

function InfographicCardPreview({ syntax }: { syntax: string }) {
  const { resolvedTheme } = useAppearanceTheme();
  const previewSyntax = infographicPreviewSyntax(syntax, resolvedTheme === "dark");
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || isVisible) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let instance: { render: (s: string) => void; destroy: () => void } | null = null;

    void import("@antv/infographic").then(({ Infographic }) => {
      if (cancelled || !containerRef.current) return;
      try {
        instance = new Infographic({
          container: containerRef.current,
          width: "100%",
          height: "100%",
          padding: 16,
          editable: false,
          svg: { style: { width: "100%", height: "100%", maxHeight: "100%", display: "block" } },
        });
        instance.render(previewSyntax);
        if (!cancelled) setReady(true);
      } catch (err) {
        console.error("Failed to render card preview", err);
      }
    });

    return () => {
      cancelled = true;
      try {
        instance?.destroy();
      } catch {}
    };
  }, [isVisible, previewSyntax]);

  return (
    <div
      ref={rootRef}
      className="relative w-full aspect-[16/10] overflow-hidden rounded-lg border border-border flex items-center justify-center"
      // The artwork has its own theme; application tokens would darken a light canvas.
      style={{ backgroundColor: infographicUsesDarkSheet(previewSyntax) ? "#1f1f1f" : "#ffffff" }}
      data-infographic-card-preview=""
    >
      <div
        ref={containerRef}
        className={cn(
          "w-full h-full pointer-events-none flex items-center justify-center p-1.5 transition-opacity duration-200",
          ready ? "opacity-100" : "opacity-0",
          "[&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:mx-auto [&_svg]:object-contain"
        )}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="h-5 w-20 rounded bg-muted-foreground/20 animate-pulse" />
        </div>
      )}
    </div>
  );
}

const CATEGORY_ICONS: Record<InfographicSampleCategory, React.ComponentType<{ className?: string }>> = {
  sequence: Milestone,
  compare: ArrowRightLeft,
  list: Layers,
  quadrant: Compass,
  hierarchy: GitFork,
  relation: Network,
  chart: BarChart3,
};

const CATEGORY_COLORS: Record<
  InfographicSampleCategory,
  { bg: string; text: string; border: string; badge: string }
> = {
  sequence: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", badge: "bg-emerald-100/70 text-emerald-800" },
  compare: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", badge: "bg-sky-100/70 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200" },
  list: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", badge: "bg-violet-100/70 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200" },
  quadrant: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", badge: "bg-amber-100/70 text-amber-800" },
  hierarchy: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", badge: "bg-indigo-100/70 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" },
  relation: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", badge: "bg-teal-100/70 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200" },
  chart: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", badge: "bg-rose-100/70 text-rose-800" },
};

export function InfographicGallery({ onSelect, readOnly = false, className, isDialog = false }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "zh-CN";
  const [selectedCategory, setSelectedCategory] = useState<InfographicSampleCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSamples = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return INFOGRAPHIC_SAMPLES.filter((sample) => {
      if (selectedCategory !== "all" && sample.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const title = getSampleTitle(sample, lang).toLowerCase();
      const desc = getSampleDesc(sample, lang).toLowerCase();
      return title.includes(q) || desc.includes(q);
    });
  }, [selectedCategory, searchQuery, lang]);

  const handleSelectSample = (sample: InfographicSample) => {
    if (readOnly) return;
    const syntax = getSampleSyntax(sample, lang);
    const title = getSampleTitle(sample, lang);
    onSelect(sample, syntax, title);
  };

  return (
    <div className={cn("flex flex-col gap-4 text-foreground", isDialog ? "p-1" : "mx-auto max-w-6xl p-4 sm:p-6", className)} data-infographic-gallery="">
      {/* Header section */}
      <div>
        <h2 className="text-lg font-bold text-foreground tracking-tight sm:text-xl">
          {t("infographic.galleryTitle")}
        </h2>
      </div>

      {/* Filter and search bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Category tabs */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            aria-pressed={selectedCategory === "all"}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {t("infographic.galleryCategoryAll")} ({INFOGRAPHIC_SAMPLES.length})
          </button>
          {INFOGRAPHIC_SAMPLE_CATEGORIES.map((cat) => {
            const count = INFOGRAPHIC_SAMPLES.filter((s) => s.category === cat.id).length;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {t(`infographic.${cat.key}`)} ({count})
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="relative min-w-[200px] max-w-xs shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("infographic.gallerySearchPlaceholder")}
            className="h-8 pl-8 pr-7 text-xs"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Grid of sample cards */}
      {filteredSamples.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-12 text-center">
          <p className="text-sm text-muted-foreground">{t("infographic.noPreview")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSamples.map((sample) => {
            const Icon = CATEGORY_ICONS[sample.category] ?? Milestone;
            const theme = CATEGORY_COLORS[sample.category] ?? CATEGORY_COLORS.sequence;
            const title = getSampleTitle(sample, lang);
            const desc = getSampleDesc(sample, lang);
            const catObj = INFOGRAPHIC_SAMPLE_CATEGORIES.find((c) => c.id === sample.category);
            const catLabel = catObj ? t(`infographic.${catObj.key}`) : sample.category;

            return (
              <div
                key={sample.id}
                role="button"
                tabIndex={readOnly ? -1 : 0}
                onClick={() => handleSelectSample(sample)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectSample(sample);
                  }
                }}
                className={cn(
                  "group relative flex flex-col justify-between rounded-xl border border-border bg-card text-card-foreground p-4 shadow-sm transition-all duration-150 text-left",
                  readOnly
                    ? "opacity-75 cursor-default"
                    : "cursor-pointer hover:-translate-y-0.5 hover:border-emerald-500/80 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                )}
                data-infographic-sample-card={sample.id}
              >
                <div className="space-y-3">
                  {/* Visual Preview */}
                  <InfographicCardPreview syntax={getSampleSyntax(sample, lang)} />

                  {/* Top bar with category badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide",
                        theme.badge
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      <span>{catLabel}</span>
                    </span>
                  </div>

                  {/* Title and description */}
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-card-foreground group-hover:text-emerald-700 transition-colors">
                      {title}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {desc}
                    </p>
                  </div>
                </div>

                {/* Bottom action trigger */}
                <div className="mt-4 flex items-center justify-end border-t border-border pt-3 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium text-xs transition-colors",
                      readOnly
                        ? "text-muted-foreground"
                        : "text-muted-foreground group-hover:text-emerald-600"
                    )}
                  >
                    <span>{t("infographic.galleryUseSample")}</span>
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
