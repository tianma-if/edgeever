import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Group,
  Image,
  Lock,
  Shapes,
  Type,
  Ungroup,
  Unlock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PosterElement } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { PosterTool } from "./PosterControls";
export function PosterLayers({
  elements,
  selected,
  disabled,
  onSelect,
  onChange,
  onGroup,
  onMove,
}: {
  elements: PosterElement[];
  selected: string[];
  disabled: boolean;
  onSelect: (id: string, append: boolean) => void;
  onChange: (id: string, patch: Partial<PosterElement>) => void;
  onGroup: (ungroup: boolean) => void;
  onMove: (front: boolean, oneStep: boolean) => void;
}) {
  const { t } = useTranslation();
  const active = elements.filter((element) => selected.includes(element.id));
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {t("poster.design.layerCount", { count: elements.length })}
        </span>
        <div className="flex">
          <PosterTool
            label={t("poster.front")}
            disabled={disabled || !active.length}
            onClick={() => onMove(true, true)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </PosterTool>
          <PosterTool
            label={t("poster.backLayer")}
            disabled={disabled || !active.length}
            onClick={() => onMove(false, true)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </PosterTool>
        </div>
      </div>
      {[...elements].reverse().map((element) => {
        const Icon =
          element.type === "text"
            ? Type
            : element.type === "image"
              ? Image
              : Shapes;
        const picked = selected.includes(element.id);
        return (
          <div
            key={element.id}
            className={`group flex items-center gap-1 rounded-md border px-1 py-1 ${picked ? "border-emerald-300 bg-emerald-50/70" : "border-transparent hover:bg-slate-50/70"}`}
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-2 p-1.5 text-left"
              aria-pressed={picked}
              onClick={(event) =>
                onSelect(
                  element.id,
                  event.shiftKey || event.metaKey || event.ctrlKey,
                )
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span
                className={`min-w-0 flex-1 truncate text-xs ${element.visible === false ? "text-slate-400 line-through" : ""}`}
              >
                {element.type === "text"
                  ? element.text || t("poster.text")
                  : element.name === "decor" || element.name === "accent"
                    ? t("poster.accent")
                    : element.name}
              </span>
              {element.groupId && <Group className="h-3 w-3 text-slate-400" />}
            </button>
            <PosterTool
              label={t(
                element.visible === false
                  ? "poster.design.show"
                  : "poster.design.hide",
              )}
              disabled={disabled}
              onClick={() =>
                onChange(element.id, { visible: element.visible === false })
              }
            >
              {element.visible === false ? (
                <EyeOff className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3 opacity-40 group-hover:opacity-100" />
              )}
            </PosterTool>
            <PosterTool
              label={t(element.locked ? "poster.unlock" : "poster.lock")}
              disabled={disabled}
              onClick={() => onChange(element.id, { locked: !element.locked })}
            >
              {element.locked ? (
                <Lock className="h-3 w-3" />
              ) : (
                <Unlock className="h-3 w-3 opacity-40 group-hover:opacity-100" />
              )}
            </PosterTool>
          </div>
        );
      })}
      <div className="grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-3">
        <Button
          size="sm"
          disabled={disabled || active.length < 2}
          onClick={() => onGroup(false)}
        >
          <Group className="h-3.5 w-3.5" />
          {t("poster.design.group")}
        </Button>
        <Button
          size="sm"
          disabled={disabled || !active.some((element) => element.groupId)}
          onClick={() => onGroup(true)}
        >
          <Ungroup className="h-3.5 w-3.5" />
          {t("poster.design.ungroup")}
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-slate-400">
        {t("poster.design.multiSelectHint")}
      </p>
    </div>
  );
}
