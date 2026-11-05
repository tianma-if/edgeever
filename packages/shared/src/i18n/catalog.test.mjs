import { describe, expect, test } from "bun:test";
import { de } from "./de.ts";
import { enUS } from "./en-US.ts";
import { es } from "./es.ts";
import { fr } from "./fr.ts";
import { ja } from "./ja.ts";
import { pl } from "./pl.ts";
import { ru } from "./ru.ts";
import { zhCN } from "./zh-CN.ts";
import { zhTW } from "./zh-TW.ts";
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
    expect(supportedLocales).toEqual(["zh-CN", "zh-TW", "en-US", "ja", "pl", "ru", "es", "de", "fr"]);
    expect(collectKeys(ja)).toEqual(collectKeys(enUS));
    expect(collectKeys(ja)).toEqual(collectKeys(zhCN));
    expect(ja.login.title).toContain("サインイン");
    expect(ja.editor.imageScale).toContain("画像");
    expect(collectKeys(zhTW)).toEqual(collectKeys(enUS));
    expect(zhTW.login.title).toContain("登入");
    expect(collectKeys(pl)).toEqual(collectKeys(enUS));
    expect(pl.login.title).toContain("Zaloguj");
    expect(collectKeys(ru)).toEqual(collectKeys(enUS));
    expect(ru.login.title).toContain("Вход");
    expect(collectKeys(es)).toEqual(collectKeys(enUS));
    expect(es.login.title).toContain("Iniciar");
    expect(collectKeys(de)).toEqual(collectKeys(enUS));
    expect(de.login.title).toContain("anmelden");
    expect(collectKeys(fr)).toEqual(collectKeys(enUS));
    expect(fr.login.title).toContain("connecter");
  });
});
