import { tableOptionColor, type TableField, type TableOptionColor } from "@edgeever/shared";
import { cn } from "@/lib/utils";

type Tone = { pill: string; dot: string };

export const OPTION_TONES: Record<TableOptionColor, Tone> = {
  blue: { pill: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500" },
  teal: { pill: "bg-teal-50 text-teal-700 ring-teal-200", dot: "bg-teal-500" },
  green: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  yellow: { pill: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  orange: { pill: "bg-orange-50 text-orange-800 ring-orange-200", dot: "bg-orange-500" },
  red: { pill: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  pink: { pill: "bg-pink-50 text-pink-700 ring-pink-200", dot: "bg-pink-500" },
  purple: { pill: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500" },
  gray: { pill: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
};

/** Resolves the pill color of one option, falling back to its stable hash color. */
export const optionColor = (field: TableField, option: string): TableOptionColor => tableOptionColor(field, option);

export const optionTone = (color: TableOptionColor): Tone => OPTION_TONES[color];

export const optionDotClassName = (field: TableField, option: string) => OPTION_TONES[optionColor(field, option)].dot;

export const OptionPill = ({
  field,
  option,
  className,
}: {
  field: TableField;
  option: string;
  className?: string;
}) => {
  const color = optionColor(field, option);
  return (
    <span
      data-option-color={color}
      className={cn("inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset", OPTION_TONES[color].pill, className)}
    >
      {option}
    </span>
  );
};
