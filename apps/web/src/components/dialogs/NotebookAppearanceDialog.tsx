import { useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Check,
  ChevronDown,
  Contrast,
  Palette,
  RotateCcw,
  Search,
  Shapes,
} from "lucide-react";
import {
  isNotebookColor,
  type Notebook,
  type NotebookAppearance,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { searchAvailableNotebookIcons } from "@/lib/notebook-icon-catalog";
import { NotebookColorPicker } from "../NotebookColorPicker";
import {
  NotebookAppearanceContent,
  getNotebookIcon,
  notebookRowStyle,
} from "../NotebookAppearanceContent";

const SelectedIcon = ({ icon }: { icon: string | null }) => {
  const Icon = getNotebookIcon(icon);
  return <Icon className="h-5 w-5" strokeWidth={2.35} aria-hidden="true" />;
};

export const NotebookAppearanceDialog = ({
  notebook,
  onCancel,
  onSubmit,
}: {
  notebook: Notebook;
  onCancel: () => void;
  onSubmit: (appearance: NotebookAppearance) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const [icon, setIcon] = useState(notebook.icon);
  const [color, setColor] = useState(notebook.color ?? "");
  const [textColor, setTextColor] = useState(notebook.textColor ?? "");
  const [isBold, setIsBold] = useState(notebook.isBold ?? false);
  const [iconInverted, setIconInverted] = useState(
    notebook.iconInverted ?? false,
  );
  const [rowInverted, setRowInverted] = useState(notebook.rowInverted ?? false);
  const [visibleIconCount, setVisibleIconCount] = useState(40);
  const [iconQuery, setIconQuery] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const iconTriggerRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const validColor = color === "" || isNotebookColor(color);
  const validTextColor = textColor === "" || isNotebookColor(textColor);
  const icons = searchAvailableNotebookIcons(iconQuery);
  const appearance = {
    icon,
    color: isNotebookColor(color) ? color : null,
    textColor: isNotebookColor(textColor) ? textColor : null,
    isBold,
    iconInverted,
    rowInverted,
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!validColor || !validTextColor || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSubmit(appearance);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-[520px] gap-0 overflow-hidden p-0"
        showCloseButton={!saving}
        onEscapeKeyDown={(event) => {
          if (iconOpen) {
            event.preventDefault();
            setIconOpen(false);
            iconTriggerRef.current?.focus();
          }
        }}
      >
        <DialogHeader className="border-b border-slate-200 px-5 py-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm leading-6">
            <Palette className="h-5 w-5 text-slate-700" />
            {t("notebookAppearance.title")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="min-h-0 overflow-y-auto">
          <fieldset
            disabled={saving}
            className="min-w-0 space-y-5 bg-slate-50/70 px-5 py-5"
          >
            <legend className="sr-only">{notebook.name}</legend>
            <section className="space-y-2">
              <h3 className="px-1 text-sm font-medium text-slate-500">
                {t("notebookAppearance.iconSection")}
              </h3>
              <div className="relative rounded-xl border border-slate-200 bg-card">
                <div className="relative flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <span className="flex shrink-0 items-center gap-3 text-sm text-slate-700">
                    <Shapes
                      className="h-4 w-4 text-slate-500"
                      aria-hidden="true"
                    />
                    {t("notebookAppearance.icon")}
                  </span>
                  <div
                    className="relative w-[55%] min-w-0"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setIconOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && iconOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setIconOpen(false);
                        iconTriggerRef.current?.focus();
                      }
                    }}
                  >
                    <button
                      ref={iconTriggerRef}
                      type="button"
                      aria-label={t("notebookAppearance.icon")}
                      aria-expanded={iconOpen}
                      onClick={() => {
                        setIconQuery("");
                        setVisibleIconCount(40);
                        setIconOpen((open) => !open);
                      }}
                      className="flex h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-card px-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <SelectedIcon icon={icon} />
                        </span>
                        <span className="truncate">
                          {icon
                            ? icon.replaceAll("-", " ")
                            : t("notebookAppearance.standard")}
                        </span>
                      </span>
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {iconOpen && (
                      <div className="absolute right-0 top-full z-20 mt-2 w-[min(280px,calc(100vw-5rem))] rounded-md border border-slate-200 bg-card p-2 shadow-lg">
                        <div className="relative mb-2">
                          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                          <Input
                            autoFocus
                            value={iconQuery}
                            onKeyDown={(event) => {
                              // Searching must not submit the appearance form.
                              if (event.key === "Enter") event.preventDefault();
                            }}
                            onChange={(event) => {
                              setIconQuery(event.target.value);
                              setVisibleIconCount(40);
                            }}
                            placeholder={t("notebookAppearance.search")}
                            className="h-8 pl-8"
                          />
                        </div>
                        <div
                          className="max-h-44 overflow-y-auto"
                          onScroll={(event) => {
                            const list = event.currentTarget;
                            if (
                              list.scrollHeight -
                                list.scrollTop -
                                list.clientHeight <
                              80
                            )
                              setVisibleIconCount((count) =>
                                Math.min(count + 40, icons.length),
                              );
                          }}
                          role="listbox"
                          aria-label={t("notebookAppearance.icon")}
                        >
                          {icons.slice(0, visibleIconCount).map((item) => {
                            const Icon = getNotebookIcon(item.id);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={icon === item.id}
                                // Safari does not focus clicked buttons; keep the search
                                // focused until the option's click handler has run.
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setIcon(item.id);
                                  setIconOpen(false);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                              >
                                <Icon
                                  className="h-5 w-5 shrink-0"
                                  strokeWidth={2.35}
                                />{" "}
                                <span>{item.id.replaceAll("-", " ")}</span>
                                {icon === item.id && (
                                  <Check className="ml-auto h-4 w-4" />
                                )}
                              </button>
                            );
                          })}
                          {icons.length === 0 && (
                            <p
                              className="p-2 text-sm text-slate-500"
                              role="status"
                            >
                              {t("notebookAppearance.empty")}
                            </p>
                          )}
                        </div>
                        <p
                          className="mt-2 border-t border-slate-100 pt-2 text-right text-xs tabular-nums text-slate-500"
                          role="status"
                        >
                          {Math.min(visibleIconCount, icons.length)} /{" "}
                          {icons.length}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-3 text-sm">
                  <span className="flex items-center gap-3 text-slate-700">
                    <Palette
                      className="h-4 w-4 shrink-0 text-slate-500"
                      aria-hidden="true"
                    />
                    {t("notebookAppearance.iconColor")}
                  </span>
                  <NotebookColorPicker
                    label={t("notebookAppearance.iconColor")}
                    value={color}
                    fallback="#64748b"
                    onChange={setColor}
                  />
                </div>
                <div className="flex min-h-14 items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                  <label
                    htmlFor={`${id}-inverted`}
                    className="flex items-center gap-3 text-sm text-slate-700"
                  >
                    <Contrast
                      className="h-4 w-4 text-slate-500"
                      aria-hidden="true"
                    />
                    {t("notebookAppearance.inversion")}
                  </label>
                  <select
                    id={`${id}-inverted`}
                    className="h-9 w-[55%] min-w-0 rounded-md border border-slate-200 bg-card px-3 text-sm"
                    value={rowInverted ? "row" : iconInverted ? "icon" : "off"}
                    onChange={(event) => {
                      setIconInverted(event.target.value === "icon");
                      setRowInverted(event.target.value === "row");
                    }}
                  >
                    <option value="off">
                      {t("notebookAppearance.invertOff")}
                    </option>
                    <option value="icon">
                      {t("notebookAppearance.invertIconOnly")}
                    </option>
                    <option value="row">
                      {t("notebookAppearance.invertWholeRow")}
                    </option>
                  </select>
                </div>
                {!validColor && (
                  <p role="alert" className="text-xs text-rose-600">
                    {t("notebookAppearance.invalidColor")}
                  </p>
                )}
              </div>
            </section>
            <section className="space-y-2">
              <h3 className="px-1 text-sm font-medium text-slate-500">
                {t("notebookAppearance.textSection")}
              </h3>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-card">
                <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <label
                    htmlFor={`${id}-bold`}
                    className="flex items-center gap-3 text-sm text-slate-700"
                  >
                    <Bold
                      className="h-4 w-4 text-slate-500"
                      aria-hidden="true"
                    />
                    {t("notebookAppearance.bold")}
                  </label>
                  <span className="flex justify-end">
                    <Switch
                      id={`${id}-bold`}
                      checked={isBold}
                      onCheckedChange={setIsBold}
                    />
                  </span>
                </div>
                <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 py-3 text-sm">
                  <span className="flex items-center gap-3 text-slate-700">
                    <Palette
                      className="h-4 w-4 shrink-0 text-slate-500"
                      aria-hidden="true"
                    />
                    {t("notebookAppearance.textColor")}
                  </span>
                  <NotebookColorPicker
                    label={t("notebookAppearance.textColor")}
                    value={textColor}
                    fallback="#334155"
                    onChange={setTextColor}
                  />
                </div>
                {!validTextColor && (
                  <p role="alert" className="text-xs text-rose-600">
                    {t("notebookAppearance.invalidColor")}
                  </p>
                )}
              </div>
            </section>
            <div className="space-y-2">
              <p className="px-1 text-sm font-medium text-slate-500">
                {t("notebookAppearance.preview")}
              </p>
              <div
                data-notebook-appearance-preview
                style={notebookRowStyle(appearance)}
                className={`${rowInverted ? "notebook-inverted-row notebook-inverted-row-selected" : "edgeever-workspace-selection"} flex h-12 min-w-0 items-center gap-2 rounded-lg px-4 text-sm`}
              >
                <NotebookAppearanceContent
                  notebook={{ ...appearance, name: notebook.name }}
                  selected
                />
              </div>
              <p className="text-xs text-slate-500">
                {t("notebookAppearance.contrast")}
              </p>
            </div>
          </fieldset>
          {failed && (
            <p role="alert" className="text-sm text-rose-600">
              {t("notebookAppearance.saveError")}
            </p>
          )}
          <DialogFooter className="gap-2 border-t border-slate-200 bg-card px-5 py-4 sm:justify-between">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setIcon(null);
                setColor("");
                setTextColor("");
                setIsBold(false);
                setIconInverted(false);
                setRowInverted(false);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("notebookAppearance.reset")}
            </Button>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={onCancel}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="solid"
                className="border-slate-900 bg-slate-900 text-white hover:border-slate-800 hover:bg-slate-800 dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:hover:border-slate-100 dark:hover:bg-slate-100"
                disabled={saving || !validColor || !validTextColor}
              >
                {saving ? t("common.processing") : t("notebookAppearance.confirm")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
