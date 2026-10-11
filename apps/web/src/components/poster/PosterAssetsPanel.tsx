import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  ImagePlus,
  LoaderCircle,
  RectangleHorizontal,
  Search,
  Sparkles,
  Star,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { EdgeEverRepository } from "@/lib/repository";
import type { ResourceListItem } from "@edgeever/shared";
import { PosterSection } from "./PosterControls";
function ResourceThumbnail({
  resource,
  repository,
}: {
  resource: ResourceListItem;
  repository: EdgeEverRepository;
}) {
  const host = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [url, setUrl] = useState<string>();
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false,
      url: string | undefined;
    void repository
      .readResource(resource.id)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(url);
        else setUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, resource.id, repository]);
  return (
    <div
      ref={host}
      className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100"
    >
      {url ? (
        <img
          src={url}
          alt={resource.filename ?? "Image"}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImagePlus className="h-5 w-5 text-slate-300" />
      )}
    </div>
  );
}
export function PosterAssetsPanel({
  repository,
  disabled,
  onUpload,
  onResource,
  onShape,
  onText,
}: {
  repository: EdgeEverRepository;
  disabled: boolean;
  onUpload: () => void;
  onResource: (resource: ResourceListItem) => void;
  onShape: (shape: string) => void;
  onText: (style: "heading" | "subtitle" | "body" | "badge") => void;
}) {
  const { t } = useTranslation(),
    [resources, setResources] = useState<ResourceListItem[]>([]),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void repository
      .listResources()
      .then(({ resources }) => {
        if (!cancelled)
          setResources(
            resources.filter(
              (resource) =>
                ["image/png", "image/jpeg", "image/webp"].includes(
                  resource.mimeType ?? "",
                ) && !(resource.filename ?? "").startsWith("poster-preview"),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, retry]);
  const shapes = [
    { id: "rect", Icon: RectangleHorizontal },
    { id: "ellipse", Icon: Circle },
    { id: "pill", Icon: RectangleHorizontal },
    { id: "line", Icon: RectangleHorizontal },
    { id: "arrow", Icon: ArrowUpRight },
    { id: "star", Icon: Star },
    { id: "sparkle", Icon: Sparkles },
  ];
  return (
    <div className="space-y-4 p-3">
      <PosterSection title={t("poster.text")}>
        <div className="space-y-2">
          {(["heading", "subtitle", "body", "badge"] as const).map(
            (style, index) => (
              <button
                key={style}
                disabled={disabled}
                onClick={() => onText(style)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-card p-3 text-left hover:border-emerald-400"
              >
                <Type className="h-4 w-4 text-slate-400" />
                <span
                  className={
                    index === 0
                      ? "text-xl font-bold"
                      : index === 1
                        ? "text-base font-medium"
                        : "text-xs"
                  }
                >
                  {t(`poster.design.textStyles.${style}`)}
                </span>
              </button>
            ),
          )}
        </div>
      </PosterSection>
      <PosterSection title={t("poster.design.shape")}>
        <div className="grid grid-cols-4 gap-2">
          {shapes.map(({ id, Icon }) => (
            <button
              key={id}
              disabled={disabled}
              aria-label={t(`poster.design.shapes.${id}`)}
              onClick={() => onShape(id)}
              className="flex aspect-square items-center justify-center rounded-lg border border-slate-200 bg-card hover:border-emerald-400"
            >
              <Icon className="h-6 w-6 stroke-[1.5]" />
            </button>
          ))}
        </div>
      </PosterSection>
      <PosterSection title={t("poster.design.images")}>
        <Button
          size="sm"
          className="w-full"
          disabled={disabled}
          onClick={onUpload}
        >
          <ImagePlus className="h-4 w-4" />
          {t("poster.design.uploadImage")}
        </Button>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            aria-label={t("poster.design.searchImages")}
            placeholder={t("poster.design.searchImages")}
            className="h-8 pl-7 text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : failed ? (
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => setRetry(retry + 1)}
          >
            {t("poster.retry")}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {resources
              .filter((resource) =>
                (resource.filename ?? "")
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((resource) => (
                <button
                  key={resource.id}
                  disabled={disabled}
                  className="space-y-1 text-left"
                  onClick={() => onResource(resource)}
                >
                  <ResourceThumbnail
                    resource={resource}
                    repository={repository}
                  />
                  <p className="truncate text-[10px] text-slate-500">
                    {resource.filename}
                  </p>
                </button>
              ))}
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-slate-400">
          {t("poster.design.imageLibraryHint")}
        </p>
      </PosterSection>
    </div>
  );
}
