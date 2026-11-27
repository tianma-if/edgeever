import { createDocument } from "@mixmark-io/domino";
import { platformElementHidden, platformHtmlMarkdown, platformReadableCopy } from "./platform-clip";

// Wrapper normalization and parent/child history adapted from MaoXian Web
// Clipper, src/js/content/ui.js (e69fbf9c), Copyright (c) 2018 Mika, MIT.
// See ../THIRD_PARTY_NOTICES.md. No source-page elements are modified.
const excluded = "html,head,script,style,template,iframe,object,embed,canvas,svg,video,audio,form,input,textarea,select,button,#edgeever-region-picker,#edgeever-clipper-toast";

export const selectableRegion = (element: Element | null): element is HTMLElement => {
  if (!element || element.matches(excluded) || element.closest("#edgeever-region-picker,#edgeever-clipper-toast") || platformElementHidden(element)) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && !!(element.textContent?.trim() || element.matches("img") || element.querySelector("img"));
};

const sameBox = (a: Element, b: Element) => {
  const first = a.getBoundingClientRect(), second = b.getBoundingClientRect();
  return first.width === second.width && first.height === second.height;
};

const indivisibleChild = (element: Element, parent: Element | null) =>
  !!parent && (!!parent.closest("pre")
    || (element.matches("thead,tbody,tfoot,tr,td,th") && parent.matches("table,thead,tbody,tfoot,tr")));

const selectableDirectChild = (parent: Element): HTMLElement | undefined =>
  Array.from(parent.children).find((child): child is HTMLElement => selectableRegion(child) && !indivisibleChild(child, parent));

export const regionWrapper = (element: HTMLElement): HTMLElement => {
  const parent = element.parentElement;
  if (!parent || element.tagName === "BODY") return element;
  const pre = parent.closest("pre");
  if (selectableRegion(pre)) return regionWrapper(pre);
  if (!selectableRegion(parent)) return element;
  const hasSibling = Array.from(parent.children).some(child => child !== element && selectableRegion(child));
  return indivisibleChild(element, parent) || (sameBox(element, parent) && !hasSibling) ? regionWrapper(parent) : element;
};

export class RegionSelection {
  private history: HTMLElement[] = [];
  constructor(public element: HTMLElement) {}
  parent() {
    const parent = this.element.parentElement;
    if (selectableRegion(parent)) { this.history.push(this.element); this.element = regionWrapper(parent); }
  }
  child() {
    const previous = this.history.pop();
    if (previous && previous !== this.element && this.element.contains(previous) && selectableRegion(previous)) this.element = previous;
    else {
      const child = selectableDirectChild(this.element);
      if (child) this.element = child;
    }
  }
  sibling(direction: "previousElementSibling" | "nextElementSibling") {
    let next = this.element[direction];
    while (next && (!selectableRegion(next) || indivisibleChild(next, this.element.parentElement))) next = next[direction];
    if (selectableRegion(next)) { this.history = []; this.element = next; }
  }
  get canExpand() { return selectableRegion(this.element.parentElement); }
  get canShrink() { return this.history.some(element => element.isConnected && this.element.contains(element)) || !!selectableDirectChild(this.element); }
}

export const regionMarkdown = (element: Element, pageUrl: string): string => {
  if (!element.isConnected || platformElementHidden(element, true)) return "";
  const copy = platformReadableCopy(element, true);
  copy.querySelectorAll("#edgeever-region-picker,#edgeever-clipper-toast").forEach(node => node.remove());
  // Inert parsing keeps conversion from activating copied scripts or images.
  return platformHtmlMarkdown(createDocument(copy.outerHTML).body, pageUrl, true);
};
