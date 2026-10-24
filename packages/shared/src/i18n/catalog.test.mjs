import { describe, expect, test } from "bun:test";
import { enUS } from "./en-US.ts";
import { ja } from "./ja.ts";
import { pl } from "./pl.ts";
import { ru } from "./ru.ts";
import { zhCN } from "./zh-CN.ts";
import { supportedLocales } from "./locales.ts";

const collectKeys = (value, prefix = "") => {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object")) {
      return value.flatMap((item, index) => collectKeys(item, `${prefix}[${index}]`));
    }
    return [`${prefix}#${value.length}`];
  }
  if (!value || typeof value !== "object") {
    return [prefix];
  }
  return Object.keys(value).flatMap((key) => collectKeys(value[key], prefix ? `${prefix}.${key}` : key));
};

describe("shared i18n catalogs", () => {
  test("ships Japanese alongside Chinese and English with matching keys", () => {
    expect(supportedLocales).toEqual(["zh-CN", "en-US", "ja", "pl", "ru"]);
    expect(collectKeys(ja)).toEqual(collectKeys(enUS));
    expect(collectKeys(ja)).toEqual(collectKeys(zhCN));
    expect(ja.login.title).toContain("サインイン");
    expect(ja.editor.imageScale).toContain("画像");
    expect(collectKeys(pl)).toEqual(collectKeys(enUS));
    expect(pl.login.title).toContain("Zaloguj");
    expect(collectKeys(ru)).toEqual(collectKeys(enUS));
    expect(ru.login.title).toContain("Вход");
  });
});
