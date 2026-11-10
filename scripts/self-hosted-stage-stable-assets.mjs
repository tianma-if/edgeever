import { mkdir, readdir, rename, utimes } from "node:fs/promises";
import { join } from "node:path";

const [dist, stable] = process.argv.slice(2);
const assets = join(dist, "assets");
const stableAssets = join(stable, "assets");
await mkdir(stableAssets, { recursive: true });

for (const entry of await readdir(assets, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:woff2?|ttf|webp)$/.test(entry.name)) continue;
  const destination = join(stableAssets, entry.name);
  await rename(join(assets, entry.name), destination);
  // Keep the layer digest stable when the same asset is emitted again.
  await utimes(destination, 0, 0);
}
await utimes(stableAssets, 0, 0);
await utimes(stable, 0, 0);
