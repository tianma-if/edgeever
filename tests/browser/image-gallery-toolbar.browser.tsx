import React from "react";
import { createRoot } from "react-dom/client";
import { Editor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditableImageGallery } from "../../apps/web/src/components/editor/ImageGallery";
import { ResizableImage } from "../../apps/web/src/components/editor/ResizableImage";
import "../../apps/web/src/i18n/index";
import "../../apps/web/src/styles/globals.css";

const svg = (label: string, color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${color}"/><text x="300" y="210" text-anchor="middle" fill="white" font-size="32" font-family="sans-serif">${label}</text></svg>`)}`;
const editor = new Editor({
  extensions: [StarterKit, ResizableImage.configure({ allowBase64: true }), EditableImageGallery],
  content: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Content before the gallery" }] },
    { type: "edgeeverImageGallery", attrs: { layout: "2" }, content: [
      ["Gallery image 1", "#07130B"], ["Gallery image 2", "#344054"],
      ["Gallery image 3", "#475467"], ["Gallery image 4", "#1D2939"],
    ].map(([label, color]) => ({ type: "image", attrs: { src: svg(label, color), alt: label } })) },
    { type: "paragraph", content: [{ type: "text", text: "Content after the gallery" }] },
  ] },
});
createRoot(document.getElementById("fixture")!).render(<EditorContent editor={editor} />);
const scroller = document.getElementById("scroller")!;
const summary = document.getElementById("summary")!;
const results = document.getElementById("results")!;
const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
};
const gallery = () => scroller.querySelector<HTMLElement>(".edgeever-image-gallery")!;
const toolbar = () => scroller.querySelector<HTMLElement>(".edgeever-image-gallery__toolbar")!;
const check = (condition: boolean, label: string) => { if (!condition) throw new Error(label); };
const scrollGalleryTo = (offset: number) => {
  scroller.scrollTop += gallery().getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
};
const expectReachable = () => {
  const bounds = scroller.getBoundingClientRect();
  const floating = toolbar().getBoundingClientRect();
  check(floating.top >= bounds.top + 7 && floating.bottom <= bounds.bottom - 7, "Toolbar must fit the editor's vertical clipping bounds");
  check(floating.left >= bounds.left && floating.right <= bounds.right, "Toolbar must fit the editor's horizontal clipping bounds");
  for (const button of toolbar().querySelectorAll("button")) {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    check(hit === button || button.contains(hit), "Every toolbar button must be hit-testable");
  }
};
const record = async (name: string, run: () => Promise<void>) => {
  await run();
  const item = document.createElement("li"); item.textContent = `PASS: ${name}`; results.append(item);
};
await until(() => Boolean(gallery()), "editor mount");

document.getElementById("run")!.onclick = async () => {
  results.replaceChildren(); summary.textContent = "Running";
  try {
    await record("Gallery at the editor top flips inside; all controls remain clickable", async () => {
      gallery().focus(); scrollGalleryTo(16);
      await until(() => toolbar().dataset.placement === "bottom-start" && getComputedStyle(toolbar()).visibility === "visible", "top-edge flip");
      expectReachable();
    });
    await record("Gallery with space above keeps its toolbar above the images", async () => {
      scroller.scrollTop = 0;
      await until(() => toolbar().dataset.placement === "top-start", "above placement");
      expectReachable();
      check(toolbar().getBoundingClientRect().bottom < gallery().getBoundingClientRect().top, "Toolbar should stay outside images when there is room");
    });
    await record("Scrolling through a tall gallery keeps the controls inside the editor", async () => {
      scrollGalleryTo(-100); await pause(150); expectReachable();
    });
    await record("A gallery fully outside the viewport hides its controls", async () => {
      scrollGalleryTo(-gallery().getBoundingClientRect().height - 30);
      await until(() => getComputedStyle(toolbar()).visibility === "hidden", "offscreen hiding");
    });
    await record("Narrow editor wraps every control; layout changes still support undo", async () => {
      scroller.style.width = "260px"; scrollGalleryTo(16); gallery().focus();
      await until(() => getComputedStyle(toolbar()).visibility === "visible" && toolbar().getBoundingClientRect().height > 60, "wrapped controls");
      expectReachable();
      toolbar().querySelectorAll<HTMLButtonElement>("button")[2].click();
      await until(() => gallery().dataset.imageGalleryLayout === "3", "layout update");
      editor.commands.undo();
      await until(() => gallery().dataset.imageGalleryLayout === "2", "layout undo");
    });
    await record("Reading protection removes the editing toolbar", async () => {
      editor.setEditable(false);
      await until(() => !toolbar(), "read-only controls");
      editor.setEditable(true); scroller.style.width = "";
      await until(() => Boolean(toolbar()), "editable controls");
      gallery().focus(); scrollGalleryTo(16); await pause(150); expectReachable();
    });
    summary.textContent = "All 6 regression checks passed";
  } catch (error) {
    summary.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  }
};
