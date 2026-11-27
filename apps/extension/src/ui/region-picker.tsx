import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ArrowLeft, ArrowRight, MousePointer2, Save, X } from "lucide-react";
import { Button, Status } from "./primitives";
import { t } from "../i18n";
import { regionMarkdown, regionWrapper, RegionSelection, selectableRegion } from "../region-selection";

declare const __CLIP_REGION_CSS__: string;
type PickerService = { dispose: () => void; busy: () => boolean };
const scope = globalThis as typeof globalThis & { __edgeeverRegionPicker?: PickerService };

export function startRegionPicker() {
  // A second activation must not unlock confirmation of an in-flight save.
  if (scope.__edgeeverRegionPicker?.busy()) return;
  scope.__edgeeverRegionPicker?.dispose();
  const pageUrl = location.href;
  const previousFocus = document.activeElement;
  const host = document.createElement("div");
  host.id = "edgeever-region-picker";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;color-scheme:light dark!important";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = __CLIP_REGION_CSS__;
  const outline = document.createElement("div");
  outline.setAttribute("aria-hidden", "true");
  outline.style.cssText = "position:fixed;pointer-events:none;box-sizing:border-box;border:2px dashed #07130b;background:#07130b0a;box-shadow:0 0 0 2px #ffffffe6, inset 0 0 0 2px #ffffffe6;display:none";
  const mount = document.createElement("div");
  shadow.append(style, outline, mount);
  document.documentElement.appendChild(host);
  const root = createRoot(mount);
  let hovered: HTMLElement | null = null;
  let selection: RegionSelection | null = null;
  let busy = false;
  let error = "";
  let disposed = false;
  const abort = new AbortController();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    abort.abort();
    root.unmount();
    host.remove();
    if (scope.__edgeeverRegionPicker === service) delete scope.__edgeeverRegionPicker;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const service: PickerService = { dispose, busy: () => busy };
  scope.__edgeeverRegionPicker = service;
  const target = () => selection?.element ?? hovered;
  const draw = () => {
    const element = target();
    if (!element?.isConnected) { outline.style.display = "none"; return; }
    const box = element.getBoundingClientRect();
    Object.assign(outline.style, {
      display: "block", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      borderStyle: selection ? "solid" : "dashed",
      // The white liner keeps the edge visible on dark pages; the outer mask
      // dims everything outside the selection. Earlier shadows paint on top.
      boxShadow: `0 0 0 2px #ffffffe6, inset 0 0 0 2px #ffffffe6${selection ? ", 0 0 0 9999px #07130b2e" : ""}`,
    });
  };
  const focusSave = () => shadow.querySelector<HTMLButtonElement>("#region-save")?.focus({ preventScroll: true });
  const adjust = (direction: "parent" | "child" | "previousElementSibling" | "nextElementSibling") => {
    if (!selection || busy) return;
    if (direction === "parent" || direction === "child") selection[direction]();
    else selection.sibling(direction);
    error = "";
    draw(); render();
  };
  const reselect = () => { selection = null; hovered = null; error = ""; draw(); render(); };
  const save = async () => {
    if (!selection || busy || disposed) return;
    busy = true; error = ""; render();
    try {
      if (location.href !== pageUrl) throw new Error(t("platformPageChanged"));
      const markdown = regionMarkdown(selection.element, pageUrl);
      if (!markdown) throw new Error(t("regionEmpty"));
      const response = await chrome.runtime.sendMessage({ type: "saveRegionClip", page: {
        title: document.title.trim() || location.hostname, url: pageUrl, markdown, kind: "region",
      } });
      if (!response?.ok) throw new Error(response?.message || t("saveFailed"));
      dispose();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : t("saveFailed");
    } finally {
      busy = false;
      if (!disposed) render();
    }
  };
  function render() {
    flushSync(() => root.render(<section role="region" aria-label={t("regionPickerTitle")} lang={(chrome.i18n.getMessage("@@ui_locale") || "en").replace("_", "-")}
      onClick={event => event.stopPropagation()}
      className="fixed bottom-5 left-1/2 rounded-xl border border-border bg-card p-4 font-sans text-foreground"
      style={{ pointerEvents: "auto", width: "min(580px, calc(100% - 24px))", transform: "translateX(-50%)", boxShadow: "0 8px 32px #07130b24", zIndex: 1 }}>
      <div className="flex items-center gap-2 text-sm font-semibold"><MousePointer2 className="size-4" aria-hidden="true" />{t(selection ? "regionSelected" : "regionPickerTitle")}</div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t(selection ? "regionAdjustHint" : "regionPickHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("regionPickerTitle")}>
        {selection && <>
          <Button size="sm" disabled={busy || !selection.canExpand} onClick={() => adjust("parent")}><ArrowLeft className="size-3.5" aria-hidden="true" />{t("regionExpand")}</Button>
          <Button size="sm" disabled={busy || !selection.canShrink} onClick={() => adjust("child")}><ArrowRight className="size-3.5" aria-hidden="true" />{t("regionShrink")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={reselect}>{t("regionReselect")}</Button>
        </>}
        <Button id="region-save" size="sm" className="ms-auto" disabled={!selection || busy} onClick={() => void save()}><Save className="size-3.5" aria-hidden="true" />{t("regionSave")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={dispose}><X className="size-3.5" aria-hidden="true" />{t("regionCancel")}</Button>
      </div>
      <Status message={busy ? t("readingAndSaving") : error} busy={busy} kind={error ? "error" : "normal"} />
    </section>));
  }
  const ours = (event: Event) => event.composedPath().includes(host);
  const regionAt = (event: Event) => {
    const element = event.composedPath().find(node => node instanceof HTMLElement);
    return element instanceof HTMLElement && selectableRegion(element) ? regionWrapper(element) : null;
  };
  window.addEventListener("pointermove", event => {
    if (ours(event) || selection || busy) return;
    hovered = regionAt(event);
    draw();
  }, { capture: true, signal: abort.signal });
  const intercept = (event: Event) => {
    if (ours(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === "click" && !selection && !busy) {
      hovered = regionAt(event);
      if (hovered?.isConnected) { selection = new RegionSelection(hovered); draw(); render(); focusSave(); }
    }
  };
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
    window.addEventListener(name, intercept, { capture: true, signal: abort.signal });
  }
  window.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) dispose(); return; }
    if (!selection || busy) return;
    const directions = { ArrowLeft: "parent", ArrowRight: "child", ArrowUp: "previousElementSibling", ArrowDown: "nextElementSibling" } as const;
    if (event.key in directions) {
      event.preventDefault(); event.stopImmediatePropagation(); adjust(directions[event.key as keyof typeof directions]);
    } else if (event.key === "Enter" && (!ours(event) || shadow.activeElement?.id === "region-save")) {
      event.preventDefault(); event.stopImmediatePropagation(); void save();
    }
  }, { capture: true, signal: abort.signal });
  window.addEventListener("scroll", draw, { capture: true, passive: true, signal: abort.signal });
  window.addEventListener("resize", draw, { signal: abort.signal });
  for (const name of ["pagehide", "hashchange", "popstate"]) window.addEventListener(name, dispose, { signal: abort.signal });
  render();
  shadow.querySelector<HTMLElement>("section")?.setAttribute("tabindex", "-1");
  shadow.querySelector<HTMLElement>("section")?.focus({ preventScroll: true });
}
