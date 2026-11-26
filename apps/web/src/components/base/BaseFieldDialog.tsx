import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createTableId,
  TABLE_OPTION_COLORS,
  tableOptionColor,
  type TableDocument,
  type TableField,
  type TableFieldType,
  type TableOptionColor,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { controlClassName, FIELD_ICONS } from "@/components/table/table-cells";
import { optionTone } from "@/components/table/option-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FieldDialogState = { mode: "add" } | { mode: "edit"; field: TableField };

/** Same grouping 飞书多维表格 uses in its field type picker. */
export const FIELD_TYPE_GROUPS: { group: "basic" | "business" | "advanced"; types: TableFieldType[] }[] = [
  { group: "basic", types: ["text", "number", "select", "multiSelect", "date", "checkbox", "url", "phone", "email", "attachment"] },
  { group: "business", types: ["autoNumber", "progress", "rating", "currency", "percent"] },
  { group: "advanced", types: ["createdTime", "updatedTime"] },
];

type BaseFieldDialogProps = {
  open: boolean;
  state: FieldDialogState | null;
  document: TableDocument;
  onOpenChange: (open: boolean) => void;
  onSubmit: (field: TableField) => void;
};

/**
 * Field editor matching 飞书多维表格's 新增字段/编辑字段 dialog: title, type and the
 * per-type options (选择 options).
 */
export const BaseFieldDialog = ({ open, state, document, onOpenChange, onSubmit }: BaseFieldDialogProps) => {
  const { t } = useTranslation();
  const editing = state?.mode === "edit" ? state.field : null;
  const [name, setName] = useState("");
  const [type, setType] = useState<TableFieldType>("text");
  const [optionRows, setOptionRows] = useState<{ name: string; color: TableOptionColor }[]>([]);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const typePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!typePickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (typePickerRef.current && !typePickerRef.current.contains(event.target as Node)) setTypePickerOpen(false);
    };
    window.document.addEventListener("mousedown", handler);
    return () => window.document.removeEventListener("mousedown", handler);
  }, [typePickerOpen]);

  useEffect(() => {
    if (!open || !state) return;
    if (state.mode === "edit") {
      const field = state.field;
      setName(field.name);
      setType(field.type);
      setOptionRows((field.options ?? []).map((option) => ({ name: option, color: tableOptionColor(field, option) })));
      return;
    }
    setName(t("structuredTable.newField", { index: document.fields.length + 1 }));
    setType("text");
    setOptionRows([]);
  }, [document.fields.length, open, state, t]);

  const updateOption = (index: number, patch: Partial<{ name: string; color: TableOptionColor }>) => {
    setOptionRows((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };
  const addOption = () => {
    setOptionRows((rows) => [
      ...rows,
      { name: "", color: TABLE_OPTION_COLORS[rows.length % TABLE_OPTION_COLORS.length] },
    ]);
  };

  const canSubmit = name.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const field: TableField = {
      id: editing?.id ?? createTableId("fld"),
      name: name.trim(),
      type,
    };
    if (type === "select" || type === "multiSelect") {
      const names: string[] = [];
      const colors: Record<string, TableOptionColor> = {};
      for (const row of optionRows) {
        const option = row.name.trim();
        if (!option || names.includes(option)) continue;
        names.push(option);
        colors[option] = row.color;
      }
      field.options = names;
      if (names.length) field.optionColors = colors;
    }
    onSubmit(field);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("structuredTable.fieldDialogEdit") : t("structuredTable.fieldDialogAdd")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 px-4 pb-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span>{t("structuredTable.fieldNameLabel")}</span>
            <Input
              autoFocus
              value={name}
              aria-label={t("structuredTable.fieldNameLabel")}
              placeholder="请输入字段标题"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span>{t("structuredTable.fieldTypeLabel")}</span>
            <div className="relative" ref={typePickerRef}>
              <button
                type="button"
                className={`${controlClassName} flex w-full items-center justify-between gap-2`}
                aria-label={t("structuredTable.fieldTypeLabel")}
                aria-expanded={typePickerOpen}
                onClick={() => {
                  setTypePickerOpen((current) => !current);
                  setTypeQuery("");
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {(() => {
                    const Icon = FIELD_ICONS[type];
                    return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
                  })()}
                  <span className="truncate">{t(`structuredTable.types.${type}`)}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              {typePickerOpen ? (
                <div
                  role="listbox"
                  aria-label={t("structuredTable.fieldTypeLabel")}
                  className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-sm"
                >
                  <div className="sticky top-0 z-10 flex items-center gap-2 bg-popover px-2 pb-1 pt-1">
                    <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <input
                      autoFocus
                      value={typeQuery}
                      onChange={(event) => setTypeQuery(event.target.value)}
                      placeholder={t("structuredTable.fieldTypeSearch")}
                      aria-label={t("structuredTable.fieldTypeSearch")}
                      className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  {FIELD_TYPE_GROUPS.map(({ group, types }) => {
                    const matches = types.filter((item) =>
                      t(`structuredTable.types.${item}`).toLowerCase().includes(typeQuery.trim().toLowerCase()),
                    );
                    if (matches.length === 0) return null;
                    return (
                      <div key={group}>
                        <p className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">
                          {t(`structuredTable.fieldTypeGroup.${group}`)}
                        </p>
                        {matches.map((item) => {
                          const Icon = FIELD_ICONS[item];
                          return (
                            <button
                              key={item}
                              type="button"
                              role="option"
                              aria-selected={item === type}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${item === type ? "bg-muted/70 font-medium" : ""}`}
                              onClick={() => {
                                setType(item);
                                setTypePickerOpen(false);
                                setTypeQuery("");
                              }}
                            >
                              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">{t(`structuredTable.types.${item}`)}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </label>
          {type === "select" || type === "multiSelect" ? (
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span>{t("structuredTable.fieldOptionsLabel")}</span>
              {optionRows.length ? (
                <div className="grid gap-1">
                  {optionRows.map((row, index) => {
                    const tone = optionTone(row.color);
                    return (
                      <div key={index} className="flex items-center gap-1.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
                              aria-label={t("structuredTable.optionColor")}
                            >
                              <span className={`size-3.5 rounded-full ${tone.dot}`} aria-hidden="true" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="grid w-44 grid-cols-5 gap-1 p-2">
                            {TABLE_OPTION_COLORS.map((color) => (
                              <DropdownMenuItem
                                key={color}
                                aria-label={t(`structuredTable.optionColors.${color}`)}
                                className="size-7 justify-center p-0"
                                onSelect={() => updateOption(index, { color })}
                              >
                                <span className={`size-4 rounded-full ${optionTone(color).dot}`} aria-hidden="true" />
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Input
                          value={row.name}
                          aria-label={t("structuredTable.optionName")}
                          placeholder={t("structuredTable.selectOptionsHint")}
                          onChange={(event) => updateOption(index, { name: event.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={t("structuredTable.removeOption")}
                          onClick={() => setOptionRows((rows) => rows.filter((_, position) => position !== index))}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-1 text-[11px] text-muted-foreground">{t("structuredTable.selectOptionsHint")}</p>
              )}
              <Button type="button" variant="ghost" size="sm" className="justify-start gap-1 px-1" onClick={addOption}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t("structuredTable.addOption")}
              </Button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>{t("structuredTable.cancel")}</Button>
          <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>{t("structuredTable.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
