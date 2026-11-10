import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { isCompressibleAsset } from "./self-hosted-static.mjs";

const directory = join(process.argv[2] ?? "apps/web/dist", "assets");
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isFile() || !isCompressibleAsset(`assets/${entry.name}`)) continue;
  const path = join(directory, entry.name);
  const original = await readFile(path);
  const compressed = gzipSync(original);
  if (compressed.length < original.length) {
    await writeFile(`${path}.gz`, compressed);
    await unlink(path);
  }
}
