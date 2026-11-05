import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  registerWindowsShareMenu,
  shareFilePathsFromCommandLine,
  windowsShareCommand,
  windowsShareMenuCommands,
  windowsShareMenuLabel,
} from "./windows-share-menu.mjs";

const exePath = "C:\\Users\\Example\\AppData\\Local\\Programs\\EdgeEver\\EdgeEver.exe";

describe("Windows share menu", () => {
  test("names the verb in the desktop locale", () => {
    expect(windowsShareMenuLabel("zh-CN")).toBe("发送到 EdgeEver");
    expect(windowsShareMenuLabel("zh-TW")).toBe("傳送至 EdgeEver");
    expect(windowsShareMenuLabel("es-ES")).toBe("Enviar a EdgeEver");
    expect(windowsShareMenuLabel("de-DE")).toBe("An EdgeEver senden");
    expect(windowsShareMenuLabel("ja-JP")).toBe("EdgeEver に送る");
    expect(windowsShareMenuLabel("en-US")).toBe("Send to EdgeEver");
    expect(windowsShareMenuLabel("pl-PL")).toBe("Wyślij do EdgeEver");
    expect(windowsShareMenuLabel("ru-RU")).toBe("Отправить в EdgeEver");
  });

  test("passes one quoted path to the installed executable", () => {
    expect(windowsShareCommand(exePath)).toBe(`"${exePath}" --share-file "%1"`);
    expect(shareFilePathsFromCommandLine([
      exePath,
      "--share-file",
      "D:\\Notes\\功能梳理表.xlsx",
    ])).toEqual(["D:\\Notes\\功能梳理表.xlsx"]);
    expect(shareFilePathsFromCommandLine(["--share-file"])).toEqual([]);
    expect(shareFilePathsFromCommandLine(["--share-file", "--flag"])).toEqual([]);
  });

  test("registers a per-user verb that can open several selected files", async () => {
    const calls = [];
    const result = await registerWindowsShareMenu({
      platform: "win32",
      packaged: true,
      exePath,
      locale: "zh-CN",
      regPath: "C:\\Windows\\System32\\reg.exe",
      execFile: (command, args, _options, callback) => {
        calls.push({ command, args });
        callback(null);
      },
    });
    expect(result).toEqual({ registered: true });
    expect(calls.map((call) => call.command)).toEqual(Array(4).fill("C:\\Windows\\System32\\reg.exe"));
    expect(calls.map((call) => call.args)).toEqual(windowsShareMenuCommands(exePath, "zh-CN"));
    expect(calls[2].args).toContain("Document");
    expect(calls[3].args.at(-2)).toBe(`"${exePath}" --share-file "%1"`);
  });

  test("skips registration away from a packaged Windows app", async () => {
    const execFile = () => { throw new Error("should not run"); };
    expect(await registerWindowsShareMenu({
      platform: "darwin",
      packaged: true,
      exePath,
      locale: "zh-CN",
      execFile,
    })).toEqual({ registered: false });
    expect(await registerWindowsShareMenu({
      platform: "win32",
      packaged: false,
      exePath,
      locale: "zh-CN",
      execFile,
    })).toEqual({ registered: false });
  });

  test("installer adds the verb and uninstall removes it", () => {
    const installer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nsis", "installer.nsh"), "utf8");
    expect(installer).toContain("Software\\Classes\\*\\shell\\EdgeEver");
    expect(installer).toContain("--share-file");
    expect(installer).toContain("MultiSelectModel");
    expect(installer).toContain("DeleteRegKey HKCU \"Software\\Classes\\*\\shell\\EdgeEver\"");
  });
});
