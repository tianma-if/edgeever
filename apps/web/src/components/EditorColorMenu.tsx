import { useRef } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { TEXT_COLORS, normalizeTextColor } from "@edgeever/shared";
import { ChevronDown, RemoveFormatting } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const EditorColorMenu = ({ editor, readOnly }: { editor: Editor | null; readOnly: boolean }) => {
  const { t } = useTranslation();
  const applied = useRef(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      color: normalizeTextColor(current?.getAttributes("textStyle").color),
      backgroundColor: normalizeTextColor(current?.getAttributes("textStyle").backgroundColor),
      code: current?.isActive("codeBlock") || current?.isActive("code"),
    }),
  });
  const disabled = readOnly || !editor || editor.isDestroyed || Boolean(state?.code);
  const apply = (property: "color" | "backgroundColor", value: string) => {
    if (!editor || editor.isDestroyed || disabled) return;
    applied.current = true;
    const chain = editor.chain().focus();
    if (property === "color") {
      if (value) chain.setColor(value).run();
      else chain.unsetColor().run();
    } else {
      if (value) chain.setBackgroundColor(value).run();
      else chain.unsetBackgroundColor().run();
    }
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) applied.current = false; }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("editorToolbar.colors")}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              className="flex h-8 w-11 shrink-0 items-center justify-center gap-0.5 rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:pointer-events-none disabled:opacity-40"
            >
              <span aria-hidden="true" className="border-b-[3px] px-0.5 text-sm font-semibold leading-4" style={{ borderColor: state?.color ?? "currentColor", backgroundColor: state?.backgroundColor ?? undefined }}>A</span>
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("editorToolbar.colors")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="w-56 p-2"
        onCloseAutoFocus={(event) => { if (applied.current) event.preventDefault(); }}
      >
        {(["color", "backgroundColor"] as const).map((property) => (
          <div key={property}>
            <DropdownMenuLabel className="px-1 text-xs text-slate-500">
              {t(property === "color" ? "editorToolbar.textColor" : "editorToolbar.highlightColor")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup aria-label={t(property === "color" ? "editorToolbar.textColor" : "editorToolbar.highlightColor")} value={state?.[property] ?? ""} onValueChange={(value) => apply(property, value)} className="grid grid-cols-5 gap-1">
              {[
                { name: "default", text: "", background: "" },
                ...TEXT_COLORS,
              ].map((color) => {
                const label = color.name === "default"
                  ? t(property === "color" ? "editorToolbar.defaultColor" : "editorToolbar.noHighlight")
                  : t("editorToolbar.colorNames." + color.name);
                return (
                  <Tooltip key={color.name}>
                    <TooltipTrigger asChild>
                      <DropdownMenuRadioItem
                        value={property === "color" ? color.text : color.background}
                        aria-label={label}
                        textValue={label}
                        disabled={disabled}
                        className="relative flex h-9 justify-center rounded-md border border-slate-200 p-0 data-[state=checked]:border-slate-600 data-[state=checked]:ring-1 data-[state=checked]:ring-slate-600 [&>span:first-child]:hidden"
                      >
                        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded text-base font-medium"
                          data-ee-text-color={property === "color" ? color.name : undefined}
                          data-ee-background-color={property === "backgroundColor" ? color.name : undefined}
                          style={property === "color" ? { color: color.text || undefined } : { backgroundColor: color.background || undefined }}
                        >A</span>
                      </DropdownMenuRadioItem>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </DropdownMenuRadioGroup>
          </div>
        ))}
        <DropdownMenuSeparator className="mt-3" />
        <DropdownMenuItem disabled={disabled} onSelect={() => {
          if (!editor || editor.isDestroyed || disabled) return;
          applied.current = true;
          editor.chain().focus().unsetColor().unsetBackgroundColor().run();
        }}>
          <RemoveFormatting aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("editorToolbar.resetColors")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
