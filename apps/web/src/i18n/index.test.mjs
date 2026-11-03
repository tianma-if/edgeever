import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
const mobileEditorSource = readFileSync(new URL("../mobile-edit.tsx", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("lazy Japanese catalog", () => {
  test("does not statically import Japanese into the app-shell i18n bundle", () => {
    expect(source).not.toContain('import { ja } from "./resources/ja"');
    expect(source).toContain('await import("./resources/ja")');
    expect(source).toContain("partialBundledLanguages: true");
    expect(source).toContain("export const bootstrapI18n");
  });

  test("loads Japanese before the web and mobile editor shells render", () => {
    expect(mainSource).toContain("await bootstrapI18n()");
    expect(mobileEditorSource).toContain("void bootstrapI18n().then(() => {");
  });

  test("keeps the Japanese chunk out of HTML modulepreload and caches it after first use", () => {
    expect(viteConfig).toContain("globPatterns: []");
    expect(viteConfig).toContain("name: \"i18n-ja\"");
    expect(viteConfig).toContain("edgeever-optional-locales");
    expect(viteConfig).toContain("i18n-(?:en-US|ja|pl|ru)-");
  });

  test("loads Polish on demand like Japanese", () => {
    expect(source).not.toContain('import { pl } from "./resources/pl"');
    expect(source).toContain('await import("./resources/pl")');
    expect(viteConfig).toContain("name: \"i18n-pl\"");
  });

  test("loads Russian on demand like Polish", () => {
    expect(source).not.toContain('import { ru } from "./resources/ru"');
    expect(source).toContain('await import("./resources/ru")');
    expect(viteConfig).toContain("name: \"i18n-ru\"");
  });
});


describe("optional English catalog", () => {
  test("loads the selected locale and English fallback before rendering", () => {
    for (const locale of ["en-US", "ja", "pl", "ru", "zh-CN"]) {
      const result = spawnSync(process.execPath, ["-e", `
        import assert from "node:assert/strict";
        globalThis.document = { documentElement: { lang: "" } };
        globalThis.window = { localStorage: {
          getItem: (key) => key === "edgeever.locale.preference" ? ${JSON.stringify(locale)} : null,
          setItem() {}, removeItem() {},
        } };
        const { default: i18n, bootstrapI18n, changeAppLocale } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).pathname)});
        await bootstrapI18n();
        assert.equal(i18n.language, ${JSON.stringify(locale)});
        assert.notEqual(i18n.t("common.save"), "common.save");
        if (${JSON.stringify(locale)} !== "zh-CN") assert.ok(i18n.hasResourceBundle("en-US", "translation"));
        await changeAppLocale("en-US");
        assert.equal(i18n.t("common.save"), "Save");
        await changeAppLocale("zh-CN");
        assert.equal(i18n.t("common.save"), "保存");
      `], { encoding: "utf8" });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    }
  });
});
