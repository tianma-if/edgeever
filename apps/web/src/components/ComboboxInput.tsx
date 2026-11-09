import { useEffect, useRef, useState } from "react";
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
export function ComboboxInput({ value, onValueChange, options, placeholder, id, disabled, invalid, maxLength, className }: {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Opening shows every option, even when the field already holds a value;
  // filtering starts once the user types.
  const [filtering, setFiltering] = useState(false);
  const openList = () => {
    if (disabled) return;
    if (!open) setFiltering(false);
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
  const showCustom = Boolean(customValue) && !options.some((option) => option.value === customValue);
  // An empty list would still draw its border, so keep it closed instead.
  const listOpen = open && !disabled && (options.length > 0 || showCustom);
  const select = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Command
      ref={commandRef}
      label={placeholder}
      shouldFilter={filtering}
      data-state={listOpen ? "open" : "closed"}
      className={cn("relative overflow-visible", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && listOpen) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === "Enter") {
          if (!listOpen) event.stopPropagation();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
          <input id={id} aria-expanded={listOpen} aria-invalid={invalid || undefined} maxLength={maxLength} />
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
        <CommandGroup>
          {options.map((option) => (
            <CommandItem className="text-xs" key={option.value} value={option.value} keywords={option.label ? [option.label] : undefined} onSelect={select}>
              <span className="min-w-0 break-all">{option.label ?? option.value}</span>
            </CommandItem>
          ))}
          {showCustom ? (
            <CommandItem className="text-xs" value={customValue} onSelect={select}><span className="break-all">{customValue}</span></CommandItem>
          ) : null}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
