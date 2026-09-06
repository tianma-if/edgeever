import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertMacIcnsComplete } from "./desktop-icns.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultIconPath = join(projectRoot, "apps/desktop/assets/icon.icns");

export const PREVIEW_APP_NAME = "EdgeEver Logo Preview";

export const createPreviewInfoPlist = (bundleIdentifier) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${PREVIEW_APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>DockIconPreview</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleIdentifier}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${PREVIEW_APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <false/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

export const previewSwiftSource = `import AppKit

final class DockIconPreviewDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if let iconPath = Bundle.main.path(forResource: "AppIcon", ofType: "icns"),
           let icon = NSImage(contentsOfFile: iconPath) {
            NSApp.applicationIconImage = icon
        }
        NSApp.activate(ignoringOtherApps: false)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

let application = NSApplication.shared
let delegate = DockIconPreviewDelegate()
application.delegate = delegate
application.run()
`;

export const assertPreviewPlatform = (platform) => {
  if (platform !== "darwin") {
    throw new Error("Dock icon preview is only available on macOS.");
  }
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`);
  }
};

export const launchDockIconPreview = async ({ iconPath = defaultIconPath } = {}) => {
  assertPreviewPlatform(process.platform);
  const resolvedIconPath = resolve(iconPath);
  assertMacIcnsComplete(await readFile(resolvedIconPath), resolvedIconPath);

  const previewRoot = await mkdtemp(join(tmpdir(), "edgeever-dock-icon-preview-"));
  const appPath = join(previewRoot, `${PREVIEW_APP_NAME}.app`);
  const contentsPath = join(appPath, "Contents");
  const macosPath = join(contentsPath, "MacOS");
  const resourcesPath = join(contentsPath, "Resources");
  const sourcePath = join(previewRoot, "DockIconPreview.swift");
  const executablePath = join(macosPath, "DockIconPreview");
  const bundleIdentifier = `org.edgeever.logo-preview.v${Date.now()}p${process.pid}`;

  await mkdir(macosPath, { recursive: true });
  await mkdir(resourcesPath, { recursive: true });
  await writeFile(sourcePath, previewSwiftSource);
  await writeFile(join(contentsPath, "Info.plist"), createPreviewInfoPlist(bundleIdentifier));
  await copyFile(resolvedIconPath, join(resourcesPath, "AppIcon.icns"));

  run("xcrun", ["swiftc", sourcePath, "-o", executablePath, "-framework", "AppKit"]);
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("open", ["-n", appPath]);

  return { appPath, iconPath: resolvedIconPath };
};

if (import.meta.main) {
  try {
    const iconPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : defaultIconPath;
    const result = await launchDockIconPreview({ iconPath });
    console.log(`[preview-macos-dock-icon] showing ${basename(result.iconPath)} in the Dock as “${PREVIEW_APP_NAME}”`);
    console.log("[preview-macos-dock-icon] right-click the Dock icon and choose Quit when finished");
  } catch (error) {
    console.error(`[preview-macos-dock-icon] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
