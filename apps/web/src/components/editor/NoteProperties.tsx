import { useEffect, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Code2, Plus, Trash2 } from "lucide-react";
import { parseNoteProperties, updateNoteProperty } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const systemProperties = new Set(["created", "updated", "edgeever_id", "notebook", "pinned"]);
type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime" | "nested";
const propertyType = (name: string, value: unknown): PropertyType => {
  if (Array.isArray(value)) return value.every((item) => typeof item === "string") ? "list" : "nested";
  if (value !== null && typeof value === "object") return "nested";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "datetime";
  if ((typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) || name === "published") return "date";
  return "text";
};

const PropertyRow = ({ name, value, readOnly, onChange, onRemove }: {
  name: string; value: unknown; readOnly: boolean;
  onChange: (value: unknown) => void; onRemove: () => void;
}) => {
  const { t } = useTranslation();
  const type = propertyType(name, value);
  const display = type === "list" ? (value as string[]).join("\n") : type === "nested" ? JSON.stringify(value) : String(value ?? "");
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(display); setInvalid(false); }, [display]);
  const commit = () => {
    if (draft === display) return;
    if (type === "number" && (!draft.trim() || !Number.isFinite(Number(draft)))) { setInvalid(true); return; }
    onChange(type === "number" ? Number(draft) : type === "list" ? draft.split("\n").map((item) => item.trim()).filter(Boolean) : draft);
    setInvalid(false);
  };
  const locked = readOnly || systemProperties.has(name);
  return <div className="grid grid-cols-[minmax(80px,1fr)_minmax(0,2fr)_32px] items-start gap-2 py-1.5">
    <span className="break-words pt-2 text-sm text-muted-foreground">{name}</span>
    {type === "checkbox" ? <input className="mt-3 h-4 w-4 accent-[#16A06E]" type="checkbox" aria-label={name} checked={Boolean(value)} disabled={locked} onChange={(event) => onChange(event.target.checked)} />
      : type === "nested" ? <span className="break-all py-2 text-xs text-muted-foreground">{display}</span>
      : type === "list" || display.includes("\n") ? <textarea className="min-h-10 w-full rounded-md border bg-card px-3 py-2 text-sm" aria-label={name} placeholder={type === "list" ? t("noteProperties.listHint") : undefined} value={draft} readOnly={locked} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      : <Input className="h-9" aria-label={name} aria-invalid={invalid} type={type === "number" ? "text" : type === "date" ? "date" : "text"} value={draft} readOnly={locked}
          maxLength={name === "title" ? 160 : undefined} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(display); setInvalid(false); } }} />}
    {!locked && <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("noteProperties.remove", { name })} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>{t("noteProperties.remove", { name })}</TooltipContent></Tooltip>}
    {invalid && <p className="col-span-3 text-xs text-destructive" role="alert">{t("noteProperties.invalidNumber")}</p>}
  </div>;
};

export const NoteProperties = ({ editor, node, getPos }: NodeViewProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [editable, setEditable] = useState(editor.isEditable);
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [error, setError] = useState("");
  const source = node.textContent;
  const parsed = parseNoteProperties(source);
  useEffect(() => {
    const refresh = () => setEditable(editor.isEditable);
    refresh();
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor]);
  const replace = (next: string) => {
    const position = getPos();
    if (!editor.isEditable || position === undefined) return;
    editor.view.dispatch(editor.state.tr.insertText(next, position + 1, position + node.nodeSize - 1));
  };
  const change = (key: string, value: unknown, remove = false) => {
    try { replace(updateNoteProperty(source, key, value, remove)); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const add = () => {
    const key = name.trim();
    if (!key || Object.hasOwn(parsed.values ?? {}, key) || systemProperties.has(key)) { setError(t("noteProperties.invalidName")); return; }
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    change(key, type === "checkbox" ? false : type === "number" ? 0 : type === "list" ? [] : type === "date" ? date : "");
    setName("");
  };
  return <NodeViewWrapper className="not-prose my-4 rounded-xl border border-[var(--workspace-divider)] bg-card px-4 py-2" data-note-properties="true">
    <TooltipProvider><Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2" contentEditable={false}>
        <CollapsibleTrigger asChild><Button variant="ghost" className="gap-2 px-0 text-sm font-medium"><ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />{t("noteProperties.heading")}</Button></CollapsibleTrigger>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("noteProperties.source")} aria-pressed={sourceVisible} onClick={() => { setOpen(true); setSourceVisible((current) => !current); }}><Code2 className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t("noteProperties.source")}</TooltipContent></Tooltip>
      </div>
      <CollapsibleContent>
        {(parsed.error || error) && <p className="py-2 text-sm text-destructive" role="alert" contentEditable={false}>{t("noteProperties.invalidYaml")} {parsed.error || error}</p>}
        {!sourceVisible && !parsed.error && <div contentEditable={false}>
          {Object.entries(parsed.values ?? {}).map(([key, value]) => <PropertyRow key={key} name={key} value={value} readOnly={!editable} onChange={(next) => change(key, next)} onRemove={() => change(key, null, true)} />)}
          {editable && <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-3">
            <Input className="h-9 min-w-24 flex-1" aria-label={t("noteProperties.name")} placeholder={t("noteProperties.name")} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
            <Select value={type} onValueChange={setType}><SelectTrigger className="w-28" aria-label={t("noteProperties.type")}><SelectValue /></SelectTrigger><SelectContent>{["text", "list", "number", "checkbox", "date"].map((kind) => <SelectItem key={kind} value={kind}>{t(`noteProperties.${kind}`)}</SelectItem>)}</SelectContent></Select>
            <Button variant="ghost" className="h-9 gap-1" onClick={add}><Plus className="h-4 w-4" />{t("noteProperties.add")}</Button>
          </div>}
        </div>}
      </CollapsibleContent>
    </Collapsible></TooltipProvider>
    <div hidden={!open || (!sourceVisible && !parsed.error)} className="my-2 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-sm"><NodeViewContent /></div>
  </NodeViewWrapper>;
};
