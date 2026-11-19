import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readWebStartupGraph } from "./web-startup-graph.mjs";

test("counts eager imports and re-exports even without preload hints, while preserving lazy boundaries", () => {
  const root = mkdtempSync(join(tmpdir(), "edgeever-startup-"));
  try {
    writeFileSync(join(root, "index.html"), '<script type="module" src="/app.js"></script>');
    const files = {
      "app.js": 'import "./shell.js"; const editor = () => import("./editor.js"); /* import "./fake.js" */',
      "shell.js": 'export { value } from "./utility.js"; export * from "./utility.js";',
      "utility.js": "export const value = 1;",
      "editor.js": 'import "./large-diagram.js";',
      "large-diagram.js": "export const big = 1;",
    };
    for (const [name, code] of Object.entries(files)) writeFileSync(join(root, name), code);
    const graph = readWebStartupGraph(root);
    expect(graph.initialJavaScriptFiles).toEqual(["app.js", "shell.js", "utility.js"]);
    expect(graph.initialJavaScriptBytes).toBe(Buffer.byteLength(files["app.js"] + files["shell.js"] + files["utility.js"]));
    // Measure a lazy screen independently from the HTML entry.
    expect(readWebStartupGraph(root, ["editor.js"]).initialJavaScriptFiles).toEqual(["editor.js", "large-diagram.js"]);
    // Making the editor eager must increase the measured graph regardless of HTML hints.
    writeFileSync(join(root, "app.js"), 'import "./shell.js"; import "./editor.js";');
    expect(readWebStartupGraph(root).initialJavaScriptFiles).toContain("large-diagram.js");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
