/**
 * Build a complete macOS ICNS (and 1024 PNG master) for the desktop app.
 *
 * Why this exists:
 * electron-builder converting a lone 512 PWA PNG yields a thin ICNS that often
 * omits ic10 (1024). Dock then falls back to the generic empty placeholder —
 * including after clean installs. We prebuild a full iconutil pack and commit it.
 *
 * Usage: bun run prepare:desktop:icons
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { assertMacIcnsComplete } from "./desktop-icns.mjs";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const brandIconPath = join(projectRoot, "assets/brand/edgeever-icon.svg");
const brandMarkPath = join(projectRoot, "assets/brand/edgeever-mark.svg");
const assetsDir = join(projectRoot, "apps/desktop/assets");

/** iconutil expects these exact basenames inside a .iconset directory. */
const ICONSET_FILES = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  return result;
};

const renderIconPng = async (sourceBuffer, size, destination) => {
  await sharp(sourceBuffer, { density: 384 })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .toFile(destination);
};

const TRAY_TEMPLATE_ALPHA_THRESHOLD = 80;
const TRAY_MARK_CENTER = { x: 627, y: 580 };
// 22pt matches other macOS menu-bar extras. A round stroke adds ink so the
// open cat face keeps up with filled marks like Notion and WeChat.
export const TRAY_MARK_SCALE = 1.1;
export const TRAY_MARK_STROKE_WIDTH = 36;
export const TRAY_TEMPLATE_SIZE = 22;
export const TRAY_TEMPLATE_SIZE_2X = 44;

export const buildMacTrayTemplateSvg = (markSvg) => {
  const pathMatch = markSvg.match(/<path\b[^>]*\sd="([^"]+)"/);
  if (!pathMatch) throw new Error("Brand mark is missing a path");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="EdgeEver">
  <g transform="translate(512 512) scale(${TRAY_MARK_SCALE}) translate(-${TRAY_MARK_CENTER.x} -${TRAY_MARK_CENTER.y})">
    <path fill="#000000" stroke="#000000" stroke-width="${TRAY_MARK_STROKE_WIDTH}" stroke-linejoin="round" paint-order="stroke fill" fill-rule="evenodd" d="${pathMatch[1]}" />
  </g>
</svg>
`;
};

export const prepareTrayIcons = async ({
  markPath = brandMarkPath,
  assetsDirectory = assetsDir,
} = {}) => {
  await mkdir(assetsDirectory, { recursive: true });
  const markSvg = await readFile(markPath, "utf8");
  const templateSvg = buildMacTrayTemplateSvg(markSvg);
  await writeFile(join(assetsDirectory, "trayTemplate.svg"), templateSvg);

  const sourceBuffer = Buffer.from(templateSvg);
  const render = async (size, density, fileName) => {
    const { data, info } = await sharp(sourceBuffer, { density: 384 })
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = data[offset + 3] >= TRAY_TEMPLATE_ALPHA_THRESHOLD ? 255 : 0;
    }
    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .withMetadata({ density })
      .png({ compressionLevel: 9 })
      .toFile(join(assetsDirectory, fileName));
  };

  await render(TRAY_TEMPLATE_SIZE, 72, "trayTemplate.png");
  await render(TRAY_TEMPLATE_SIZE_2X, 144, "trayTemplate@2x.png");
  console.log("[prepare-desktop-icons] wrote macOS tray template icons from the brand mark");
};

export const prepareDesktopIcons = async ({
  sourcePath = brandIconPath,
  assetsDirectory = assetsDir,
  requireIconutil = process.platform === "darwin",
} = {}) => {
  await mkdir(assetsDirectory, { recursive: true });
  await prepareTrayIcons({ assetsDirectory });
  const sourceBuffer = await readFile(sourcePath);

  // Master PNG used by electron-builder on Windows/Linux and as a Dock fallback.
  await renderIconPng(sourceBuffer, 1024, join(assetsDirectory, "icon.png"));

  if (!requireIconutil) {
    console.log("[prepare-desktop-icons] skipped iconutil on non-macOS; master PNG written.");
    return { icnsPath: join(assetsDirectory, "icon.icns"), pngPath: join(assetsDirectory, "icon.png") };
  }

  const workRoot = await mkdtemp(join(tmpdir(), "edgeever-desktop-icon-"));
  const iconsetDir = join(workRoot, "EdgeEver.iconset");
  await mkdir(iconsetDir, { recursive: true });

  try {
    for (const { name, size } of ICONSET_FILES) {
      await renderIconPng(sourceBuffer, size, join(iconsetDir, name));
    }

    const icnsPath = join(assetsDirectory, "icon.icns");
    run("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath]);
    const icnsData = await readFile(icnsPath);
    assertMacIcnsComplete(icnsData, icnsPath);

    console.log(`[prepare-desktop-icons] wrote ${icnsPath} (${icnsData.length} bytes)`);
    console.log(`[prepare-desktop-icons] wrote ${join(assetsDirectory, "icon.png")} (1024×1024 master)`);
    return { icnsPath, pngPath: join(assetsDirectory, "icon.png") };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  try {
    await prepareDesktopIcons();
  } catch (error) {
    console.error(`[prepare-desktop-icons] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
