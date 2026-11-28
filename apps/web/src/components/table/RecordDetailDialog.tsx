import { useTranslation } from "react-i18next";
import {
  isTableMultiSelectValue,
  tableCellDisplayText,
  updateTableCell,
  type TableCellValue,
  type TableDocument,
  type TableField,
} from "@edgeever/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { controlClassName, displayCell } from "@/components/table/table-cells";

export const RecordDetailDialog = ({
  document, recordId, readOnly, onClose, onChange,
}: {
  document: TableDocument;
  recordId: string | null;
  readOnly: boolean;
  onClose: () => void;
  onChange: (next: TableDocument) => void;
}) => {
  const { t } = useTranslation();
  const record = recordId ? document.records.find((item) => item.id === recordId) : undefined;
  const recordIndex = record ? document.records.indexOf(record) : 0;
  if (!record) return null;
  const title = displayCell(document.fields[0]!, record.cells[document.fields[0]!.id] ?? null, recordIndex) || t("structuredTable.recordDetails");
  const commit = (field: TableField, value: TableCellValue) => {
    if (readOnly) return;
    onChange(updateTableCell(document, record.id, field.id, value));
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-xl p-4 sm:p-6">
        <DialogTitle className="truncate pr-8">{title}</DialogTitle>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          {document.fields.map((field) => {
            const value = record.cells[field.id] ?? null;
            const label = field.name;
            if (field.type === "autoNumber") {
              return (
                <div key={field.id} className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="tabular-nums">{tableCellDisplayText(field, value, recordIndex)}</span>
                </div>
              );
            }
            if (field.type === "attachment") {
              return (
                <div key={field.id} className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="truncate">{displayCell(field, value, recordIndex) || "—"}</span>
                </div>
              );
            }
            if (field.type === "checkbox") {
              return (
                <label key={field.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={value === true} disabled={readOnly} onCheckedChange={(checked) => commit(field, checked === true)} aria-label={label} />
                  {label}
                </label>
              );
            }
            if (field.type === "select") {
              return (
                <label key={field.id} className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <select
                    className={controlClassName}
                    value={typeof value === "string" ? value : ""}
                    disabled={readOnly}
                    aria-label={label}
                    onChange={(event) => commit(field, event.target.value || null)}
                  >
                    <option value="" />
                    {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              );
            }
            if (field.type === "multiSelect") {
              const selected = isTableMultiSelectValue(value) ? value : [];
              return (
                <fieldset key={field.id} className="grid gap-1 text-sm">
                  <legend className="text-xs text-muted-foreground">{label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {(field.options ?? []).map((option) => (
                      <label key={option} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={selected.includes(option)}
                          disabled={readOnly}
                          aria-label={`${label} ${option}`}
                          onCheckedChange={(checked) => commit(field, checked === true
                            ? [...selected, option]
                            : selected.filter((item) => item !== option))}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            const inputType = field.type === "number" ? "number" : field.type === "date" ? "date"
              : field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
            return (
              <label key={field.id} className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Input
                  type={inputType}
                  aria-label={label}
                  disabled={readOnly}
                  defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                  onBlur={(event) => commit(field, event.target.value)}
                />
              </label>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};