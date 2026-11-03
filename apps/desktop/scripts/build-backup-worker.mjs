import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = join(root, "apps/desktop/build");
await mkdir(directory, { recursive: true });
const result = await Bun.build({ entrypoints: [join(root, "apps/desktop/src/backup/worker.ts")], target: "node", format: "esm", external: ["electron"], outdir: directory, naming: "backup-worker.mjs" });
if (!result.success) throw new AggregateError(result.logs, "Could not build the desktop backup worker");
await copyFile(join(root, "node_modules/@zip.js/zip.js/LICENSE"), join(directory, "zip.js.LICENSE"));
