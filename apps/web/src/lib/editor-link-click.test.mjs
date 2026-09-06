import { describe, expect, test } from "bun:test";
import {
  resolveStoredEditorLinkOpenMode,
  shouldOpenEditorLink,
  shouldOpenInternalNoteLink,
  shouldShowEditorLinkOpenHint,
} from "./editor-link-click.ts";

const primaryClick = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
};

describe("editor link click policy", () => {
  test("requires the modifier by default when no preference is stored", () => {
    expect(resolveStoredEditorLinkOpenMode(null)).toBe("modifier");
    expect(resolveStoredEditorLinkOpenMode("unsupported")).toBe("modifier");
  });

  test("preserves an explicitly stored link opening mode", () => {
    expect(resolveStoredEditorLinkOpenMode("click")).toBe("click");
    expect(resolveStoredEditorLinkOpenMode("modifier")).toBe("modifier");
  });

  test("shows a hover hint only when desktop editing requires a modifier", () => {
    expect(shouldShowEditorLinkOpenHint(true, false, "click")).toBe(false);
    expect(shouldShowEditorLinkOpenHint(true, false, "modifier")).toBe(true);
    expect(shouldShowEditorLinkOpenHint(true, true, "modifier")).toBe(false);
    expect(shouldShowEditorLinkOpenHint(false, false, "modifier")).toBe(false);
  });

  test("opens on plain primary click when the modifier is not required", () => {
    expect(shouldOpenEditorLink(primaryClick, true)).toBe(true);
    expect(shouldOpenEditorLink(primaryClick, true, { requireModifier: false })).toBe(true);
  });

  test("keeps a normal primary click inside an editable document when requireModifier", () => {
    expect(shouldOpenEditorLink(primaryClick, true, { requireModifier: true })).toBe(false);
  });

  test("opens an editable link with Ctrl-click when requireModifier", () => {
    expect(shouldOpenEditorLink({ ...primaryClick, ctrlKey: true }, true, { requireModifier: true })).toBe(true);
  });

  test("opens an editable link with Command-click when requireModifier", () => {
    expect(shouldOpenEditorLink({ ...primaryClick, metaKey: true }, true, { requireModifier: true })).toBe(true);
  });

  test("opens a link normally in a read-only document even with requireModifier", () => {
    expect(shouldOpenEditorLink(primaryClick, false, { requireModifier: true })).toBe(true);
  });

  test("opens an internal note reference on a primary click with or without modifiers", () => {
    expect(shouldOpenInternalNoteLink(primaryClick, "memo-1")).toBe(true);
    expect(shouldOpenInternalNoteLink({ ...primaryClick, metaKey: true }, "memo-1")).toBe(true);
    expect(shouldOpenInternalNoteLink({ ...primaryClick, ctrlKey: true }, "memo-1")).toBe(true);
    expect(shouldOpenInternalNoteLink({ ...primaryClick, button: 1 }, "memo-1")).toBe(false);
    expect(shouldOpenInternalNoteLink(primaryClick, null)).toBe(false);
  });

  test("does not handle non-primary buttons", () => {
    expect(shouldOpenEditorLink({ ...primaryClick, button: 1 }, false)).toBe(false);
    expect(shouldOpenEditorLink({ ...primaryClick, button: 1 }, true, { requireModifier: true })).toBe(false);
  });
});
