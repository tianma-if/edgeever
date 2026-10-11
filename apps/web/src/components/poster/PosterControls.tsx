import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export function PosterTool({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  text = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  text?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={text ? "sm" : "icon"}
          variant={active ? "soft" : "ghost"}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={
            active ? "text-emerald-700 bg-emerald-50 border-emerald-200" : ""
          }
        >
          {children}
          {text && <span>{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function PosterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-slate-200/60 pb-4 last:border-0">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
export function PosterNumber({
  label,
  value,
  onChange,
  min = -8192,
  max = 8192,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));
  useEffect(() => {
    setDraft(String(Number(value.toFixed(2))));
  }, [value]);
  const apply = () => {
    const number = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(number) &&
      number >= min &&
      number <= max
    )
      onChange(number);
    else setDraft(String(Number(value.toFixed(2))));
  };
  return (
    <label className="space-y-1 text-[11px] text-slate-500">
      <span>{label}</span>
      <Input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="h-8 px-2 text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
export const POSTER_SWATCHES = [
  "#07130b",
  "#ffffff",
  "#f4efe4",
  "#16a06e",
  "#baf264",
  "#ffe04b",
  "#ff6b45",
  "#e63946",
  "#2563eb",
  "#7c3aed",
  "#fb7185",
  "#14b8a6",
];
export function PosterColor({
  label,
  value,
  onChange,
  disabled = false,
  swatches = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  swatches?: boolean;
}) {
  const hex = /^#[a-f0-9]{6}$/i.test(value) ? value : "#000000";
  const [draft, setDraft] = useState(hex);
  useEffect(() => setDraft(hex), [hex]);
  const apply = () => {
    if (/^#[a-f0-9]{6}$/i.test(draft)) onChange(draft);
    else setDraft(hex);
  };
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <span className="flex-1 text-slate-500">{label}</span>
        <input
          type="color"
          aria-label={label}
          value={hex}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <Input
          aria-label={`${label} HEX`}
          className="h-7 w-24 px-2 font-mono text-xs"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              apply();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      {swatches && (
        <div className="grid grid-cols-6 gap-1.5">
          {POSTER_SWATCHES.map((color) => (
            <button
              key={color}
              disabled={disabled}
              aria-label={`${label} ${color}`}
              aria-pressed={hex.toLowerCase() === color}
              onClick={() => onChange(color)}
              className={`h-6 rounded border border-black/10 ${hex.toLowerCase() === color ? "ring-2 ring-emerald-500 ring-offset-2" : ""}`}
              style={{ background: color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
