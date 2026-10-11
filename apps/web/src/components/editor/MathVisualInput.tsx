import { useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";
import "./math-visual-input.css";
import placeholderStyles from "./mathlive-placeholder.css?inline";

export const MathVisualInput = ({
  id, value, label, loadingLabel, language, hint, onChange, onLoadError,
}: {
  id: string;
  value: string;
  label: string;
  loadingLabel: string;
  language: string;
  hint?: string;
  onChange: (value: string) => void;
  onLoadError: () => void;
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const keyboardHostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const latestRef = useRef({ value, onChange, onLoadError });
  latestRef.current = { value, onChange, onLoadError };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("./mathlive-loader").then(({ MathfieldElement, convertLatexToMarkup }) => {
      const host = hostRef.current;
      const keyboardHost = keyboardHostRef.current;
      if (cancelled || !host || !keyboardHost) return;
      MathfieldElement.locale = language.toLowerCase();
      const field = new MathfieldElement();
      field.id = id;
      field.setAttribute("aria-label", label);
      field.mathVirtualKeyboardPolicy = "manual";
      field.placeholderSymbol = "\u25a2";
      field.setValue(latestRef.current.value, { silenceNotifications: true });
      // Expand MathLive-specific macros (e.g. imaginaryI) into portable LaTeX
      // before passing it to KaTeX or persisting it in the document.
      const handleInput = () => latestRef.current.onChange(field.getValue("latex-expanded"));
      field.addEventListener("input", handleInput);
      host.appendChild(field);
      const placeholderStyle = document.createElement("style");
      placeholderStyle.textContent = placeholderStyles;
      field.shadowRoot?.appendChild(placeholderStyle);
      // The pinned MathLive version emits slots as ordinary glyph spans rather
      // than exposing a CSS part. Mark only its dedicated placeholder symbol.
      const markInputSlots = () => {
        field.shadowRoot?.querySelectorAll("span[data-atom-id]").forEach((element) => {
          if (element.children.length === 0 && element.textContent === "\u25a2") {
            element.classList.add("edgeever-math-input-slot");
          }
        });
      };
      const slotObserver = new MutationObserver(markInputSlots);
      if (field.shadowRoot) slotObserver.observe(field.shadowRoot, { childList: true, subtree: true });
      markInputSlots();
      field.menuItems = [];
      fieldRef.current = field;
      if (field.getValue("latex-expanded") !== latestRef.current.value) handleInput();

      // Keep the keyboard inside Radix's modal focus/pointer boundary.
      const keyboard = window.mathVirtualKeyboard;
      const originalLayouts = keyboard.layouts;
      const keyLabels: Record<string, string> = {
        "#@^2}": "\\square^2",
        "#@^{#0}}": "\\square^{\\square}",
        "\\sqrt{#0}": "\\sqrt{\\square}",
      };
      keyboard.layouts = keyboard.normalizedLayouts.map((layout) => ({
        ...layout,
        layers: layout.layers.map((layer) => ({
          ...layer,
          rows: layer.rows?.map((row) => row.map((key) => {
            const label = key.latex && keyLabels[key.latex];
            return label ? { ...key, label: convertLatexToMarkup(label) } : key;
          })),
        })),
      }));
      keyboard.container = keyboardHost;
      const resizeKeyboard = () => {
        keyboardHost.style.height = `${keyboard.boundingRect.height}px`;
      };
      keyboard.addEventListener("geometrychange", resizeKeyboard);
      dispose = () => {
        slotObserver.disconnect();
        keyboard.removeEventListener("geometrychange", resizeKeyboard);
        keyboard.hide();
        keyboard.layouts = originalLayouts;
        keyboard.container = null;
        field.removeEventListener("input", handleInput);
        field.remove();
        fieldRef.current = null;
      };
      setReady(true);
      field.focus();
      keyboard.show();
      resizeKeyboard();
    }).catch((error: unknown) => {
      dispose?.();
      console.error("Failed to load the formula editor", error);
      if (!cancelled) latestRef.current.onLoadError();
    });
    return () => { cancelled = true; dispose?.(); };
  }, [id, label, language]);

  useEffect(() => {
    const field = fieldRef.current;
    if (field && field.getValue("latex-expanded") !== value) field.setValue(value, { silenceNotifications: true });
  }, [value, ready]);

  return (
    <div className="edgeever-math-visual-input space-y-2">
      {!ready && <p role="status" className="text-xs text-slate-500">{loadingLabel}</p>}
      <div ref={hostRef} />
      {hint && <p role="status" className="text-xs leading-5 text-slate-500">{hint}</p>}
      <div ref={keyboardHostRef} className="relative w-full overflow-hidden rounded-md" />
    </div>
  );
};
