import { memo, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  buildPosterDesign,
  DESIGN_TEMPLATES,
  templatesFor,
} from "@/lib/poster-design/templates";
import { renderPosterThumbnail } from "@/lib/poster-canvas";

type Template = (typeof DESIGN_TEMPLATES)[number];
const Preview = memo(function Preview({
  template,
  width,
  height,
  zh,
  selected,
  onSelect,
  disabled,
}: {
  template: Template;
  width: number;
  height: number;
  zh: boolean;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const host = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false),
    [url, setUrl] = useState<string>();
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false,
      preview: string | undefined;
    void buildPosterDesign({
      id: template.id,
      title: zh ? "把想法\n变成作品" : "MAKE IDEAS\nWORTH SHARING",
      subtitle: zh ? "一个好想法，值得被看见。" : "Ideas deserve to be seen.",
      badge: zh ? "创作笔记" : "CREATIVE NOTES",
      width,
      height,
      zh,
    })
      .then(renderPosterThumbnail)
      .then((next) => {
        preview = next;
        if (cancelled) URL.revokeObjectURL(next);
        else setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setUrl(undefined);
      });
    return () => {
      cancelled = true;
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [visible, width, height, zh, template.id]);
  return (
    <button
      ref={host}
      disabled={disabled}
      data-poster-template={template.id}
      aria-label={zh ? template.zh : template.en}
      aria-pressed={selected}
      onClick={onSelect}
      className={`group overflow-hidden rounded-lg border p-1.5 text-left transition disabled:opacity-50 ${selected ? "border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500" : "border-slate-200/80 bg-card hover:border-emerald-400"}`}
    >
      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-slate-100">
        {url ? (
          <img
            src={url}
            alt={zh ? template.zh : template.en}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-[10px] text-slate-400">
            {zh ? "载入版式…" : "Loading layout…"}
          </span>
        )}
      </div>
      <div className="mt-2 truncate px-1 text-[11px] font-medium">
        {zh ? template.zh : template.en}
      </div>
    </button>
  );
});
export function PosterTemplatePanel({
  width,
  height,
  platformId,
  templateId,
  zh,
  disabled,
  onApply,
}: {
  width: number;
  height: number;
  platformId?: string;
  templateId?: string;
  zh: boolean;
  disabled: boolean;
  onApply: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(""),
    [recommended, setRecommended] = useState(true);
  const templates = (
    recommended ? templatesFor(platformId) : DESIGN_TEMPLATES
  ).filter((template) =>
    `${template.zh} ${template.en} ${template.zhUse} ${template.enUse}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-4 p-3">
      <div className="sticky -top-0.5 z-10 space-y-2 bg-card py-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">
            {t("poster.templates")}{" "}
            <span className="font-normal text-slate-400">
              {templates.length}
            </span>
          </h3>
          <button
            className="text-[11px] text-emerald-600"
            onClick={() => setRecommended(!recommended)}
          >
            {t(
              recommended
                ? "poster.design.allTemplates"
                : "poster.design.recommended",
            )}
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            className="h-8 pl-8 text-xs"
            value={search}
            aria-label={t("poster.design.searchTemplates")}
            placeholder={t("poster.design.searchTemplates")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {templates.map((template) => (
          <Preview
            key={template.id}
            template={template}
            width={width}
            height={height}
            zh={zh}
            selected={template.id === templateId}
            onSelect={() => onApply(template.id)}
            disabled={disabled}
          />
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-slate-400">
        {t("poster.design.templateCredit")}
      </p>
    </div>
  );
}
