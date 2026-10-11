import { join, win32 } from "node:path";

// Inspect existing EdgeEver pins; never create, repin, or overwrite user shortcuts.
export const inspectWindowsTaskbarShortcuts = async ({
  platform, packaged, appData, executable, readdir, readShortcutLink, existsSync,
}) => {
  if (platform !== "win32" || !packaged) return null;
  const directory = join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
  let filenames;
  try { filenames = await readdir(directory); }
  catch (error) {
    return { executable, state: error.code === "ENOENT" ? "no-pins-directory" : "unavailable", code: error.code || null, shortcuts: [] };
  }
  const shortcuts = [];
  for (const filename of filenames.filter((name) => /^edgeever\.lnk$/i.test(name))) {
    try {
      const shortcut = readShortcutLink(join(directory, filename));
      shortcuts.push({
        name: filename,
        target: shortcut.target,
        targetExists: existsSync(shortcut.target),
        matchesExecutable: win32.normalize(shortcut.target).toLowerCase() === win32.normalize(executable).toLowerCase(),
        appUserModelId: shortcut.appUserModelId || null,
      });
    } catch (error) {
      shortcuts.push({ name: filename, state: "unreadable", code: error.code || null });
    }
  }
  return { executable, state: "inspected", shortcuts };
};
