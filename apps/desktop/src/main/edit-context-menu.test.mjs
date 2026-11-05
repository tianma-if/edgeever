import { describe, expect, test } from "bun:test";
import { buildEditContextMenuTemplate } from "./edit-context-menu.mjs";
import { desktopMenuCopy } from "./desktop-menu.mjs";

const copy = desktopMenuCopy("en-US");
const allowAll = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const shape = (template) => template.map((item) => item.type === "separator" ? "-" : item.role ?? item.label);

describe("desktop edit context menu", () => {
  test("editable field gets standard editing items with paste-as-plain-text", () => {
    const template = buildEditContextMenuTemplate({ isEditable: true, selectionText: "", editFlags: allowAll }, copy);
    expect(shape(template)).toEqual(["cut", "copy", "paste", "pasteAndMatchStyle", "-", "selectAll"]);
    expect(template.map((item) => item.label).filter(Boolean)).toEqual([
      "Cut", "Copy", "Paste", "Paste as Plain Text", "Select All",
    ]);
  });

  test("editFlags drive enabled state", () => {
    const template = buildEditContextMenuTemplate({
      isEditable: true,
      selectionText: "",
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    }, copy);
    const byRole = Object.fromEntries(template.filter((item) => item.role).map((item) => [item.role, item.enabled]));
    expect(byRole).toEqual({ cut: false, copy: false, paste: true, pasteAndMatchStyle: true, selectAll: true });

    const noPaste = buildEditContextMenuTemplate({ isEditable: true, editFlags: { ...allowAll, canPaste: false } }, copy);
    expect(noPaste.find((item) => item.role === "paste").enabled).toBe(false);
    expect(noPaste.find((item) => item.role === "pasteAndMatchStyle").enabled).toBe(false);
  });

  test("non-editable selection offers only Copy", () => {
    const template = buildEditContextMenuTemplate({ isEditable: false, selectionText: "hello", editFlags: allowAll }, copy);
    expect(shape(template)).toEqual(["copy"]);
  });

  test("link offers Copy link address and writes the URL", () => {
    const copied = [];
    const template = buildEditContextMenuTemplate(
      { isEditable: false, selectionText: "", linkURL: "https://example.com/a", editFlags: allowAll },
      copy,
      { copyLink: (url) => copied.push(url) },
    );
    expect(shape(template)).toEqual(["Copy Link Address"]);
    template[0].click();
    expect(copied).toEqual(["https://example.com/a"]);

    const withSelection = buildEditContextMenuTemplate(
      { isEditable: false, selectionText: "link text", linkURL: "https://example.com/a", editFlags: allowAll },
      copy,
    );
    expect(shape(withSelection)).toEqual(["Copy Link Address", "-", "copy"]);
  });

  test("misspelled word shows up to five suggestions and Add to dictionary", () => {
    const replaced = [];
    const added = [];
    const template = buildEditContextMenuTemplate({
      isEditable: true,
      selectionText: "",
      misspelledWord: "helo",
      dictionarySuggestions: ["hello", "help", "held", "hero", "halo", "helot"],
      editFlags: allowAll,
    }, copy, {
      replaceMisspelling: (word) => replaced.push(word),
      addToDictionary: (word) => added.push(word),
    });
    expect(shape(template)).toEqual([
      "hello", "help", "held", "hero", "halo", "Add to Dictionary", "-",
      "cut", "copy", "paste", "pasteAndMatchStyle", "-", "selectAll",
    ]);
    template[0].click();
    template[5].click();
    expect(replaced).toEqual(["hello"]);
    expect(added).toEqual(["helo"]);
  });

  test("misspelled word without suggestions still offers Add to dictionary", () => {
    const template = buildEditContextMenuTemplate({
      isEditable: true, misspelledWord: "qwzx", dictionarySuggestions: [], editFlags: allowAll,
    }, copy);
    expect(shape(template).slice(0, 2)).toEqual(["Add to Dictionary", "-"]);
  });

  test("returns an empty template when there is nothing to show", () => {
    expect(buildEditContextMenuTemplate({ isEditable: false, selectionText: "", linkURL: "", editFlags: allowAll }, copy)).toEqual([]);
    expect(buildEditContextMenuTemplate({ isEditable: false, selectionText: "   " }, copy)).toEqual([]);
    expect(buildEditContextMenuTemplate(undefined, copy)).toEqual([]);
  });

  test("never adds app-specific formatting commands", () => {
    const template = buildEditContextMenuTemplate({ isEditable: true, selectionText: "x", editFlags: allowAll }, copy);
    const roles = template.filter((item) => item.role).map((item) => item.role);
    expect(roles.every((role) => ["cut", "copy", "paste", "pasteAndMatchStyle", "selectAll"].includes(role))).toBe(true);
    expect(template.every((item) => item.type === "separator" || item.role)).toBe(true);
  });

  test("context menu labels are localized for Chinese and Polish", () => {
    expect(desktopMenuCopy("zh-CN").pasteAsPlainText).toBe("粘贴为纯文本");
    expect(desktopMenuCopy("en").pasteAsPlainText).toBe("Paste as Plain Text");
    const pl = desktopMenuCopy("pl-PL");
    expect([pl.cut, pl.copy, pl.paste, pl.pasteAsPlainText, pl.selectAll, pl.addToDictionary, pl.copyLinkAddress]).toEqual([
      "Wytnij", "Kopiuj", "Wklej", "Wklej jako zwykły tekst", "Zaznacz wszystko", "Dodaj do słownika", "Kopiuj adres linku",
    ]);
    expect(desktopMenuCopy("pl").file).toBe("Plik");
    expect(desktopMenuCopy("plx").file).toBe("File");
  });

  test("resolves Japanese and Russian menu copy", () => {
    expect(desktopMenuCopy("ja-JP").file).toBe("ファイル");
    expect(desktopMenuCopy("ja").pasteAsPlainText).toBe("プレーンテキストとしてペースト");
    expect(desktopMenuCopy("ru").file).toBe("Файл");
    expect(desktopMenuCopy("ru-RU").edit).toBe("Правка");
    expect(desktopMenuCopy("es").file).toBe("Archivo");
    expect(desktopMenuCopy("de").file).toBe("Datei");
    expect(desktopMenuCopy("zh-TW").file).toBe("檔案");
  });

  test("every locale defines the same menu keys", () => {
    const keys = Object.keys(desktopMenuCopy("en")).sort();
    expect(Object.keys(desktopMenuCopy("zh")).sort()).toEqual(keys);
    for (const locale of ["zh", "zh-TW", "pl", "ja", "ru", "es", "de"]) {
      const copy = desktopMenuCopy(locale);
      expect(Object.keys(copy).sort()).toEqual(keys);
      expect(Object.values(copy).every((value) => typeof value === "string" && value.trim() !== "")).toBe(true);
    }
    expect(desktopMenuCopy("ja")).not.toBe(desktopMenuCopy("en"));
    expect(desktopMenuCopy("ru")).not.toBe(desktopMenuCopy("en"));
    expect(desktopMenuCopy("es")).not.toBe(desktopMenuCopy("en"));
    expect(desktopMenuCopy("de")).not.toBe(desktopMenuCopy("en"));
    expect(desktopMenuCopy("zh-TW")).not.toBe(desktopMenuCopy("en"));
  });
});
