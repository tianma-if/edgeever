import { describe, expect, test } from "bun:test";
import {
  listMemoTemplateGallery,
  localizeMemoTemplateGalleryItem,
  MEMO_TEMPLATE_GALLERY,
} from "./memo-template-gallery.ts";
import { DEFAULT_MEMO_TEMPLATE_SEEDS } from "./memo-template-seeds.ts";

const locales = ["zh-CN", "en-US", "ja", "pl"];

describe("memo template gallery", () => {
  test("offers unique templates that do not overlap the default seeds", () => {
    const keys = MEMO_TEMPLATE_GALLERY.map((item) => item.key);
    const seedKeys = new Set(DEFAULT_MEMO_TEMPLATE_SEEDS.map((seed) => seed.key));

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => seedKeys.has(key))).toEqual([]);
  });

  test("translates every template into every supported language", () => {
    for (const item of MEMO_TEMPLATE_GALLERY) {
      for (const locale of locales) {
        const translation = item.translations[locale];
        expect(translation.title.trim()).not.toBe("");
        expect(translation.description.trim()).not.toBe("");
        expect(translation.contentMarkdown.trim()).not.toBe("");
      }
    }
  });

  test("localizes entries ready to save as user templates", () => {
    const [journal] = MEMO_TEMPLATE_GALLERY;

    expect(localizeMemoTemplateGalleryItem(journal, "pl-PL")).toEqual({
      key: "daily-journal",
      name: journal.translations.pl.title,
      description: journal.translations.pl.description,
      title: journal.translations.pl.title,
      contentMarkdown: journal.translations.pl.contentMarkdown,
      tags: ["template", "daily-journal"],
    });
    expect(localizeMemoTemplateGalleryItem(journal, "ko-KR").name).toBe("Daily Journal");
    expect(localizeMemoTemplateGalleryItem(journal, null).name).toBe("每日日志");
  });

  test("lists the whole gallery in the requested language", () => {
    const entries = listMemoTemplateGallery("ja");

    expect(entries).toHaveLength(MEMO_TEMPLATE_GALLERY.length);
    expect(entries.map((entry) => entry.name)).toEqual(
      MEMO_TEMPLATE_GALLERY.map((item) => item.translations.ja.title),
    );
  });
});
