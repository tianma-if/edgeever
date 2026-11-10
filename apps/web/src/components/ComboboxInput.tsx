import { useEffect, useRef, useState } from "react";
import { defaultFilter } from "cmdk";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  // Shown instead of the value and also matched when filtering.
  label?: string;
};

// A text field with a filterable list of suggestions: the user can type any value
// or pick one. A typed value missing from the list is offered as the last item.
// The list is positioned inside the field's own scroll container, so scrolling
// moves it with the field instead of leaving it behind.
export function ComboboxInput({ value, onValueChange, options, placeholder, labelledBy, disabled, invalid, maxLength, className, onOpenChange }: {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder: string;
  // The id of a visible label for the field. cmdk otherwise names it by its own
  // hidden label, which reads the placeholder. There is deliberately no `id` prop:
  // cmdk refocuses the input by its generated id whenever the highlight changes,
  // so overriding it moves focus to the list and drops the next keystrokes.
  labelledBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  maxLength?: number;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Opening shows every option, even when the field already holds a value;
  // filtering starts once the user types.
  const [filtering, setFiltering] = useState(false);
  // The highlighted item is set explicitly when the list opens: the current value,
  // or the first option when the field is empty. cmdk would otherwise pick the
  // first item, and Enter would silently replace the value.
  const [active, setActive] = useState("");
  const openList = () => {
    if (disabled) return;
    if (!open) {
      setFiltering(false);
      setActive(value.trim() || options[0]?.value || "");
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !commandRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const customValue = value.trim();
  // With nothing to pick from, echoing the typed text as the only item adds noise.
  const showCustom = options.length > 0 && Boolean(customValue) && !options.some((option) => option.value === customValue);
  // An empty list would still draw its border, so keep it closed instead.
  const listOpen = open && !disabled && (options.length > 0 || showCustom);
  useEffect(() => { onOpenChange?.(listOpen); }, [listOpen, onOpenChange]);
  // A highlighted value further down a long list is scrolled into view when the list opens.
  useEffect(() => {
    if (!listOpen) return;
    const frame = requestAnimationFrame(() => {
      commandRef.current?.querySelector('[cmdk-item][aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [listOpen]);
  const select = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Command
      ref={commandRef}
      label={placeholder}
      shouldFilter={filtering}
      // Match on the trimmed text, like the value that is kept, so edge spaces
      // cannot hide every item while the list stays open.
      filter={(itemValue, search, keywords) => defaultFilter(itemValue, search.trim(), keywords)}
      value={active}
      onValueChange={setActive}
      data-state={listOpen ? "open" : "closed"}
      className={cn("relative overflow-visible", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDownCapture={(event) => {
        // Only the input drives cmdk. A key on the toggle button (Enter or Space
        // activates it) must not reach cmdk, which would confirm the highlighted
        // item and overwrite the field.
        if (event.target !== inputRef.current && event.key !== "Escape" && event.key !== "Tab") {
          event.stopPropagation();
          return;
        }
        if (event.key === "Escape" && listOpen) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === "Enter") {
          if (!listOpen) event.stopPropagation();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          // The first arrow only opens the list on the current value; letting cmdk
          // handle it too would move the highlight from a stale item.
          if (!open) {
            event.preventDefault();
            event.stopPropagation();
          }
          openList();
        }
      }}
    >
      <div className={cn(
        "relative rounded-md border border-slate-200 focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-900/10 [&_[cmdk-input-wrapper]]:rounded-md [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]>svg]:hidden",
        invalid && "border-rose-500 focus-within:border-rose-500 focus-within:ring-rose-500/10",
      )}>
        <CommandInput
          asChild
          ref={inputRef}
          value={value}
          onValueChange={(nextValue) => { onValueChange(nextValue); setFiltering(true); setOpen(true); }}
          onFocus={openList}
          onClick={openList}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="pr-9"
        >
          {/* Spread only when set: an undefined value would still override cmdk's own label reference. */}
          <input {...(labelledBy ? { "aria-labelledby": labelledBy } : {})} aria-expanded={listOpen} aria-invalid={invalid || undefined} maxLength={maxLength} />
        </CommandInput>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1"
          aria-label={placeholder}
          aria-expanded={listOpen}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { inputRef.current?.focus(); openList(); }}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
      <CommandList
        hidden={!listOpen}
        // overscroll-contain keeps the wheel from scrolling the page once the list ends.
        className="absolute top-full z-50 mt-1 max-h-60 w-full overscroll-contain rounded-md border border-slate-200 bg-card shadow-md"
        onMouseDown={(event) => event.preventDefault()}
      >
        {/* Remove the scored items while closed so cmdk resets its selection
            before reopening, when the current value becomes the highlight. */}
        {listOpen && <CommandGroup>
          {options.map((option) => (
            <CommandItem className="text-xs" key={option.value} value={option.value} keywords={option.label ? [option.label] : undefined} onSelect={select}>
              <span className="min-w-0 break-all">{option.label ?? option.value}</span>
            </CommandItem>
          ))}
          {showCustom ? (
            <CommandItem className="text-xs" value={customValue} onSelect={select}><span className="break-all">{customValue}</span></CommandItem>
          ) : null}
        </CommandGroup>}
      </CommandList>
    </Command>
  );
}
