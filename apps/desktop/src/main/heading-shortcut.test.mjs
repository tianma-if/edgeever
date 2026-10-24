import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { headingShortcutLevelFromEvent } from "../../../web/src/lib/editor-shortcuts.ts";
import {
  createHeadingShortcutGuard,
  headingLevelFromShortcutInput,
  shouldClaimParagraphShortcut,
} from "./heading-shortcut.mjs";

const shortcut = (overrides = {}) => ({
  type: "keyDown",
  key: "0",
  code: "Digit0",
  isAutoRepeat: false,
  isComposing: false,
  shift: false,
  control: true,
  alt: false,
  meta: false,
  ...overrides,
});

describe("desktop heading shortcut guard", () => {
  test("matches the editor chord for the same physical key", () => {
    for (const input of [
      shortcut({ key: "1", code: "Digit1" }),
      shortcut({ key: "&", code: "Digit1" }),
      shortcut({ key: "6", code: "Numpad6", control: false, meta: true }),
      shortcut({ key: "0", code: "Digit0", shift: true }),
      shortcut({ key: "0", code: "Digit0", alt: true }),
      shortcut({ key: "0", code: "Digit0", isComposing: true }),
      shortcut({ key: "0", code: "Digit0", isAutoRepeat: true }),
      shortcut({ key: "7", code: "Digit7" }),
      shortcut({ control: false, meta: false }),
    ]) {
      expect(headingLevelFromShortcutInput(input)).toBe(headingShortcutLevelFromEvent({
        key: input.key,
        code: input.code,
        ctrlKey: input.control,
        metaKey: input.meta,
        altKey: input.alt,
        shiftKey: input.shift,
        isComposing: input.isComposing,
        repeat: input.isAutoRepeat,
      }));
    }
    expect(headingLevelFromShortcutInput(shortcut({ type: "keyUp" }))).toBeNull();
  });

  test("claims Mod+0 only while the rich text editor owns the chord", () => {
    expect(shouldClaimParagraphShortcut(shortcut(), false)).toBe(false);
    expect(shouldClaimParagraphShortcut(shortcut({ control: false, meta: true }), true)).toBe(true);
    expect(shouldClaimParagraphShortcut(shortcut({ key: "2", code: "Digit2" }), true)).toBe(false);
    expect(shouldClaimParagraphShortcut(shortcut({ shift: true }), true)).toBe(false);
  });

  test("stops the zoom shortcut and asks the editor to restore body text", () => {
    const guard = createHeadingShortcutGuard();
    const prevented = [];
    const sent = [];
    const webContents = {
      listeners: {},
      on(name, listener) { this.listeners[name] = listener; },
      send(channel, level) { sent.push([channel, level]); },
    };

    guard.attach(webContents);
    guard.setActive(true);
    webContents.listeners["before-input-event"](
      { preventDefault: () => prevented.push("mod-0") },
      shortcut(),
    );
    webContents.listeners["before-input-event"](
      { preventDefault: () => prevented.push("mod-1") },
      shortcut({ key: "1", code: "Digit1" }),
    );

    expect(prevented).toEqual(["mod-0"]);
    expect(sent).toEqual([["desktop:heading-shortcut", 0]]);

    webContents.listeners["did-start-loading"]();
    expect(guard.isActive()).toBe(false);
    guard.setActive(true);
    guard.reset();
    expect(guard.isActive()).toBe(false);
  });

  test("wires the guard through the desktop window and preload", () => {
    const indexSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    const preloadSource = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");

    expect(indexSource).toContain('ipcMain.on("desktop:rich-text-heading-shortcut"');
    expect(indexSource).toContain("headingShortcutGuard.attach(mainWindow.webContents)");
    expect(indexSource).toContain("headingShortcutGuard.reset()");
    expect(preloadSource).toContain('ipcRenderer.sendSync("desktop:rich-text-heading-shortcut"');
    expect(preloadSource).toContain('ipcRenderer.on("desktop:heading-shortcut"');
  });
});
