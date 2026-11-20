import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileAssetsDir = path.join(projectRoot, "apps/mobile/assets");
const brandIconPath = path.join(projectRoot, "assets/brand/edgeever-icon.svg");
const mobileIconPath = path.join(mobileAssetsDir, "icon.png");
const adaptiveIconSourcePath = path.join(mobileAssetsDir, "adaptive-icon-transparent.svg");
const adaptiveIconPath = path.join(mobileAssetsDir, "adaptive-icon-transparent.png");

export async function prepareMobileIcons() {
  await mkdir(mobileAssetsDir, { recursive: true });
  // Expo renders the 180dp splash logo at 720px for xxxhdpi.
  await sharp(brandIconPath, { density: 384 })
    .resize(1024, 1024)
    .png({ compressionLevel: 9 })
    .toFile(mobileIconPath);
  await sharp(adaptiveIconSourcePath, { density: 384 })
    .resize(1024, 1024)
    .png()
    .toFile(adaptiveIconPath);

  console.log("已同步 Android 图标资源");
}

if (import.meta.main) {
  await prepareMobileIcons();
}
