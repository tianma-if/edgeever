import { useTranslation } from "react-i18next";
import type { PosterDocument } from "@edgeever/shared";
import { PLATFORMS } from "@/lib/poster-design/templates";
import { PosterColor, PosterNumber, PosterSection } from "./PosterControls";
export function PosterCanvasSettings({
  document,
  disabled,
  zh,
  onChange,
  onResize,
  onPlatform,
}: {
  document: PosterDocument;
  disabled: boolean;
  zh: boolean;
  onChange: (document: PosterDocument) => void;
  onResize: (width: number, height: number) => void;
  onPlatform: (id: string) => void;
}) {
  const { t } = useTranslation();
  const gradient = document.backgroundGradient;
  return (
    <div className="space-y-4 p-4">
      <PosterSection title={t("poster.design.platform")}>
        <div className="grid grid-cols-2 gap-2">
          {PLATFORMS.map((platform) => (
            <button
              key={platform.id}
              disabled={disabled}
              className={`rounded-lg border p-2 text-left transition ${platform.width === document.width && platform.height === document.height && (!document.platformId || document.platformId === platform.id) ? "border-emerald-500 bg-emerald-50/60" : "border-slate-200 hover:border-emerald-300"}`}
              onClick={() => onPlatform(platform.id)}
            >
              <div className="truncate text-[11px] font-medium">
                {zh ? platform.zh : platform.en}
              </div>
              <div className="mt-1 text-[10px] tabular-nums text-slate-400">
                {platform.width} × {platform.height}
              </div>
            </button>
          ))}
        </div>
      </PosterSection>
      <PosterSection title={t("poster.design.customSize")}>
        <div className="grid grid-cols-2 gap-2">
          <PosterNumber
            label={t("poster.design.width")}
            min={320}
            max={4096}
            value={document.width}
            disabled={disabled}
            onChange={(width) => onResize(Math.round(width), document.height)}
          />
          <PosterNumber
            label={t("poster.design.height")}
            min={320}
            max={4096}
            value={document.height}
            disabled={disabled}
            onChange={(height) => onResize(document.width, Math.round(height))}
          />
        </div>
      </PosterSection>
      <PosterSection title={t("poster.background")}>
        <div className="grid grid-cols-2 rounded-md bg-slate-100/70 p-1 text-xs">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              disabled={disabled}
              aria-pressed={Boolean(gradient) === value}
              className={`rounded px-2 py-1.5 ${Boolean(gradient) === value ? "bg-card shadow-sm" : "text-slate-500"}`}
              onClick={() =>
                onChange({
                  ...document,
                  backgroundGradient: value
                    ? {
                        kind: "linear",
                        from: document.background,
                        to: "#baf264",
                        angle: 120,
                      }
                    : undefined,
                })
              }
            >
              {t(value ? "poster.design.gradient" : "poster.design.solid")}
            </button>
          ))}
        </div>
        <PosterColor
          label={t(
            gradient ? "poster.design.gradientFrom" : "poster.background",
          )}
          value={gradient?.from ?? document.background}
          disabled={disabled}
          swatches
          onChange={(color) =>
            onChange({
              ...document,
              background: color,
              backgroundGradient: gradient
                ? { ...gradient, from: color }
                : undefined,
            })
          }
        />
        {gradient && (
          <>
            <PosterColor
              label={t("poster.design.gradientTo")}
              value={gradient.to}
              disabled={disabled}
              onChange={(to) =>
                onChange({
                  ...document,
                  backgroundGradient: { ...gradient, to },
                })
              }
            />
            <PosterNumber
              label={t("poster.design.rotation")}
              value={gradient.angle}
              min={-360}
              max={360}
              disabled={disabled}
              onChange={(angle) =>
                onChange({
                  ...document,
                  backgroundGradient: { ...gradient, angle },
                })
              }
            />
            <div className="grid grid-cols-3 gap-2">
              {[
                ["#f4efe4", "#ffdbbc"],
                ["#dbeafe", "#ddd6fe"],
                ["#07130b", "#16a06e"],
                ["#fce7f3", "#fb7185"],
                ["#dcfce7", "#baf264"],
                ["#111827", "#4f46e5"],
              ].map(([from, to]) => (
                <button
                  key={from}
                  disabled={disabled}
                  className="h-8 rounded-md border border-black/5"
                  aria-label={`${from} ${to}`}
                  style={{
                    background: `linear-gradient(120deg,${from},${to})`,
                  }}
                  onClick={() =>
                    onChange({
                      ...document,
                      background: from,
                      backgroundGradient: {
                        kind: "linear",
                        from,
                        to,
                        angle: 120,
                      },
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
      </PosterSection>
    </div>
  );
}
