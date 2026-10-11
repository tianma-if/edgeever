import { expect, test } from "bun:test";
import { inspectWindowsTaskbarShortcuts } from "./windows-taskbar-diagnostics.mjs";

const dependencies = {
  platform: "win32", packaged: true, appData: "C:\\Users\\Example\\AppData\\Roaming",
  executable: "C:\\Programs\\EdgeEver\\EdgeEver.exe",
  readdir: async () => ["EdgeEver.lnk", "Other App.lnk"],
  readShortcutLink: () => ({ target: "C:\\OldInstall\\EdgeEver.exe", appUserModelId: "org.edgeever.desktop" }),
  existsSync: () => false,
};

test("identifies stale EdgeEver shortcut targets without reading other applications", async () => {
  const result = await inspectWindowsTaskbarShortcuts(dependencies);
  expect(result.shortcuts).toHaveLength(1);
  expect(result.shortcuts[0]).toMatchObject({ targetExists: false, matchesExecutable: false, target: "C:\\OldInstall\\EdgeEver.exe" });
});

test("treats Windows executable path casing as equivalent", async () => {
  const result = await inspectWindowsTaskbarShortcuts({ ...dependencies,
    readShortcutLink: () => ({ target: "c:\\programs\\edgeever\\edgeever.exe" }), existsSync: () => true,
  });
  expect(result.shortcuts[0]).toMatchObject({ targetExists: true, matchesExecutable: true });
});

test("missing pins and unsupported platforms do not interrupt startup", async () => {
  expect(await inspectWindowsTaskbarShortcuts({ ...dependencies, platform: "darwin" })).toBeNull();
  const result = await inspectWindowsTaskbarShortcuts({ ...dependencies, readdir: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } });
  expect(result.state).toBe("no-pins-directory");
});
