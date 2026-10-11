import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bold,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Image,
  Italic,
  Lock,
  Trash2,
  Underline,
  Unlock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { PosterElement } from "@edgeever/shared";
import { POSTER_FONTS } from "@/lib/poster-design/fonts";
import {
  PosterColor,
  PosterNumber,
  PosterSection,
  PosterTool,
} from "./PosterControls";
export type PosterAlign =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
export function PosterInspector({
  elements,
  disabled,
  onPatch,
  onAlign,
  onDuplicate,
  onDelete,
  onImageFit,
  zh,
}: {
  elements: PosterElement[];
  disabled: boolean;
  onPatch: (patch: Partial<PosterElement>) => void;
  onAlign: (align: PosterAlign) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onImageFit: (cover: boolean) => void;
  zh: boolean;
}) {
  const { t } = useTranslation();
  const active = elements.length === 1 ? elements[0] : undefined;
  const locked = elements.some((element) => element.locked),
    editable = !disabled && !locked;
  const alignments = [
    "left",
    "center",
    "right",
    "top",
    "middle",
    "bottom",
  ] as const;
  const icons = [
    ArrowLeftToLine,
    AlignHorizontalDistributeCenter,
    ArrowRightToLine,
    ArrowUpToLine,
    AlignVerticalDistributeCenter,
    ArrowDownToLine,
  ];
  if (!elements.length)
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center text-slate-400">
        <Image className="h-9 w-9 stroke-1" />
        <p className="text-xs leading-relaxed">
          {t("poster.design.selectHint")}
        </p>
      </div>
    );
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {elements.length > 1
            ? t("poster.design.selectionCount", { count: elements.length })
            : active?.type === "text"
              ? t("poster.text")
              : active?.type === "image"
                ? t("poster.image")
                : t("poster.design.shape")}
        </h2>
        <div className="flex gap-0.5">
          <PosterTool
            label={t("poster.design.duplicate")}
            disabled={!editable}
            onClick={onDuplicate}
          >
            <Copy className="h-3.5 w-3.5" />
          </PosterTool>
          <PosterTool
            label={t("poster.delete")}
            disabled={!editable}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </PosterTool>
        </div>
      </div>
      {active && (
        <Input
          aria-label={t("poster.layerName")}
          className="h-8 text-xs"
          value={active.name}
          disabled={disabled}
          onChange={(event) =>
            onPatch({ name: event.target.value.slice(0, 120) })
          }
        />
      )}
      <PosterSection title={t("poster.design.position")}>
        <div className="grid grid-cols-6 gap-0.5">
          {alignments.map((align, index) => {
            const Icon = icons[index];
            return (
              <PosterTool
                key={align}
                label={t(`poster.design.align.${align}`)}
                disabled={!editable}
                onClick={() => onAlign(align)}
              >
                <Icon className="h-4 w-4" />
              </PosterTool>
            );
          })}
        </div>
        {active && (
          <div className="grid grid-cols-2 gap-2">
            <PosterNumber
              label="X"
              value={active.x}
              disabled={!editable}
              onChange={(x) => onPatch({ x })}
            />
            <PosterNumber
              label="Y"
              value={active.y}
              disabled={!editable}
              onChange={(y) => onPatch({ y })}
            />
            <PosterNumber
              label={t("poster.design.width")}
              value={active.width}
              min={1}
              disabled={!editable}
              onChange={(width) => onPatch({ width })}
            />
            <PosterNumber
              label={t("poster.design.height")}
              value={active.height}
              min={1}
              disabled={!editable}
              onChange={(height) => onPatch({ height })}
            />
            <PosterNumber
              label={t("poster.design.rotation")}
              value={active.rotation}
              min={-360}
              max={360}
              disabled={!editable}
              onChange={(rotation) => onPatch({ rotation })}
            />
            <PosterNumber
              label={t("poster.design.opacity")}
              value={active.opacity * 100}
              min={0}
              max={100}
              disabled={!editable}
              onChange={(opacity) => onPatch({ opacity: opacity / 100 })}
            />
          </div>
        )}
      </PosterSection>
      {active?.type === "text" && (
        <>
          <PosterSection title={t("poster.design.typography")}>
            <Textarea
              aria-label={t("poster.text")}
              value={active.text}
              disabled={!editable}
              maxLength={8000}
              className="min-h-20 resize-y text-xs"
              onChange={(event) =>
                onPatch({
                  text: event.target.value,
                  sourceText: event.target.value,
                })
              }
            />
            <select
              aria-label={t("poster.fontFamily")}
              className="h-9 w-full rounded-md border border-slate-200 bg-card px-2 text-xs"
              value={active.fontFamily}
              disabled={!editable}
              onChange={(event) => onPatch({ fontFamily: event.target.value })}
            >
              <option value="sans-serif">{t("poster.sans")}</option>
              <option value="serif">{t("poster.serif")}</option>
              <option value="monospace">{t("poster.mono")}</option>
              {POSTER_FONTS.map((font) => (
                <option key={font.family} value={font.family}>
                  {zh ? font.zh : font.en}
                </option>
              ))}
            </select>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <PosterNumber
                  label={t("poster.fontSize")}
                  value={active.fontSize}
                  min={4}
                  max={1024}
                  disabled={!editable}
                  onChange={(fontSize) => onPatch({ fontSize })}
                />
              </div>
              <div className="flex pb-0.5">
                <PosterTool
                  label={t("poster.bold")}
                  active={active.fontWeight === "bold"}
                  disabled={!editable}
                  onClick={() =>
                    onPatch({
                      fontWeight:
                        active.fontWeight === "bold" ? "normal" : "bold",
                    })
                  }
                >
                  <Bold className="h-4 w-4" />
                </PosterTool>
                <PosterTool
                  label={t("poster.design.italic")}
                  active={active.fontStyle === "italic"}
                  disabled={!editable}
                  onClick={() =>
                    onPatch({
                      fontStyle:
                        active.fontStyle === "italic" ? "normal" : "italic",
                    })
                  }
                >
                  <Italic className="h-4 w-4" />
                </PosterTool>
                <PosterTool
                  label={t("poster.design.underline")}
                  active={active.underline}
                  disabled={!editable}
                  onClick={() => onPatch({ underline: !active.underline })}
                >
                  <Underline className="h-4 w-4" />
                </PosterTool>
              </div>
            </div>
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((align, index) => {
                const Icon = [AlignLeft, AlignCenter, AlignRight][index];
                return (
                  <PosterTool
                    key={align}
                    label={t(`poster.design.textAlign.${align}`)}
                    active={active.textAlign === align}
                    disabled={!editable}
                    onClick={() => onPatch({ textAlign: align })}
                  >
                    <Icon className="h-4 w-4" />
                  </PosterTool>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PosterNumber
                label={t("poster.design.lineHeight")}
                value={active.lineHeight ?? 1.25}
                min={0.5}
                max={3}
                step={0.05}
                disabled={!editable}
                onChange={(lineHeight) => onPatch({ lineHeight })}
              />
              <PosterNumber
                label={t("poster.design.tracking")}
                value={active.charSpacing ?? 0}
                min={-300}
                max={1000}
                disabled={!editable}
                onChange={(charSpacing) => onPatch({ charSpacing })}
              />
            </div>
            <PosterColor
              label={t("poster.color")}
              value={active.fill}
              disabled={!editable}
              onChange={(fill) => onPatch({ fill, gradient: undefined })}
              swatches
            />
          </PosterSection>
          {active.badge && (
            <PosterSection title={t("poster.design.badgeBackground")}>
              <PosterColor
                label={t("poster.background")}
                value={active.badge.background}
                disabled={!editable}
                onChange={(background) =>
                  onPatch({ badge: { ...active.badge!, background } })
                }
              />
            </PosterSection>
          )}
        </>
      )}
      {active && active.type !== "text" && active.type !== "image" && (
        <PosterSection title={t("poster.design.fill")}>
          <PosterColor
            label={t("poster.color")}
            value={active.fill}
            disabled={!editable}
            onChange={(fill) => onPatch({ fill, gradient: undefined })}
            swatches
          />
          {active.type === "rect" && (
            <PosterNumber
              label={t("poster.design.radius")}
              value={active.radius ?? 0}
              min={0}
              max={Math.min(active.width, active.height) / 2}
              disabled={!editable}
              onChange={(radius) => onPatch({ radius })}
            />
          )}
        </PosterSection>
      )}
      {active?.type === "image" && (
        <PosterSection title={t("poster.design.imageAdjust")}>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              disabled={!editable}
              onClick={() => onImageFit(false)}
            >
              {t("poster.design.fitImage")}
            </Button>
            <Button
              size="sm"
              disabled={!editable}
              onClick={() => onImageFit(true)}
            >
              {t("poster.design.coverImage")}
            </Button>
          </div>
          <div className="flex gap-1">
            <PosterTool
              label={t("poster.design.flipHorizontal")}
              disabled={!editable}
              onClick={() => onPatch({ flipX: !active.flipX })}
            >
              <FlipHorizontal className="h-4 w-4" />
            </PosterTool>
            <PosterTool
              label={t("poster.design.flipVertical")}
              disabled={!editable}
              onClick={() => onPatch({ flipY: !active.flipY })}
            >
              <FlipVertical className="h-4 w-4" />
            </PosterTool>
          </div>
          {active.crop && (
            <div className="grid grid-cols-2 gap-2">
              <PosterNumber
                label={t("poster.design.cropX")}
                min={0}
                max={Math.max(0, 100 * (1 - active.crop.width))}
                value={active.crop.x * 100}
                onChange={(x) =>
                  onPatch({ crop: { ...active.crop!, x: x / 100 } })
                }
                disabled={!editable}
              />
              <PosterNumber
                label={t("poster.design.cropY")}
                min={0}
                max={Math.max(0, 100 * (1 - active.crop.height))}
                value={active.crop.y * 100}
                onChange={(y) =>
                  onPatch({ crop: { ...active.crop!, y: y / 100 } })
                }
                disabled={!editable}
              />
            </div>
          )}
        </PosterSection>
      )}
      {active && active.type !== "image" && (
        <>
          <PosterSection title={t("poster.design.outline")}>
            <div className="grid grid-cols-2 gap-2">
              <PosterNumber
                label={t("poster.design.strokeWidth")}
                value={active.strokeWidth ?? 0}
                min={0}
                max={100}
                disabled={!editable}
                onChange={(strokeWidth) =>
                  onPatch({ strokeWidth, stroke: active.stroke ?? "#07130b" })
                }
              />
              <PosterColor
                label={t("poster.color")}
                value={active.stroke ?? "#07130b"}
                disabled={!editable}
                onChange={(stroke) =>
                  onPatch({ stroke, strokeWidth: active.strokeWidth || 2 })
                }
              />
            </div>
          </PosterSection>
          <PosterSection title={t("poster.design.shadow")}>
            <label className="flex items-center justify-between text-xs">
              <span>{t("poster.design.enableShadow")}</span>
              <input
                type="checkbox"
                checked={Boolean(active.shadow)}
                disabled={!editable}
                onChange={(event) =>
                  onPatch({
                    shadow: event.target.checked
                      ? { color: "#000000", blur: 12, offsetX: 4, offsetY: 6 }
                      : undefined,
                  })
                }
              />
            </label>
            {active.shadow && (
              <div className="space-y-2">
                <PosterColor
                  label={t("poster.color")}
                  value={active.shadow.color}
                  disabled={!editable}
                  onChange={(color) =>
                    onPatch({ shadow: { ...active.shadow!, color } })
                  }
                />
                <div className="grid grid-cols-3 gap-2">
                  <PosterNumber
                    label={t("poster.design.blur")}
                    value={active.shadow.blur}
                    min={0}
                    max={300}
                    disabled={!editable}
                    onChange={(blur) =>
                      onPatch({ shadow: { ...active.shadow!, blur } })
                    }
                  />
                  <PosterNumber
                    label="X"
                    value={active.shadow.offsetX}
                    min={-300}
                    max={300}
                    disabled={!editable}
                    onChange={(offsetX) =>
                      onPatch({ shadow: { ...active.shadow!, offsetX } })
                    }
                  />
                  <PosterNumber
                    label="Y"
                    value={active.shadow.offsetY}
                    min={-300}
                    max={300}
                    disabled={!editable}
                    onChange={(offsetY) =>
                      onPatch({ shadow: { ...active.shadow!, offsetY } })
                    }
                  />
                </div>
              </div>
            )}
          </PosterSection>
        </>
      )}
      <Button
        className="w-full"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onPatch({ locked: !locked })}
      >
        {locked ? (
          <Unlock className="h-3.5 w-3.5" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        {t(locked ? "poster.unlock" : "poster.lock")}
      </Button>
    </div>
  );
}
