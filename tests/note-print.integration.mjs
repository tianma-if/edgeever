// Actual production-page regression for #767. Run after bun run build:web:
// node tests/note-print.integration.mjs
// Uses an isolated Electron window/profile; never opens the installed app.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));

if (!process.versions.electron) {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-print-test-"));
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(desktopRequire("electron"), [fileURLToPath(import.meta.url), directory], {
      stdio: "inherit", env,
    });
    const timeout = setTimeout(() => child.kill(), 90_000);
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", resolveExit);
    }).finally(() => clearTimeout(timeout));
    assert.equal(code, 0, "Electron print regression must succeed");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const name of ["long", "short", "mixed"]) {
      const metrics = JSON.parse(await readFile(join(directory, `${name}.json`), "utf8"));
      const task = getDocument({ data: new Uint8Array(await readFile(join(directory, `${name}.pdf`))) });
      const pdf = await task.promise;
      assert.equal(pdf.numPages, metrics.pages, `${name}: saved page count must match preview`);
      let text = "";
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        text += content.items.map((item) => item.str ?? "").join(" ");
      }
      assert.ok(text.includes("END-OF-NOTE"), `${name}: PDF must contain final paragraph`);
      console.log(`PASS ${name}: ${pdf.numPages} PDF pages, final paragraph present, empty paragraphs retain line height`);
      await task.destroy();
    }
  } finally {
    if (process.env.EDGE_EVER_KEEP_PRINT_TEST_OUTPUT) console.log(`Artifacts: ${directory}`);
    else await rm(directory, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = desktopRequire("electron");
  const { PRINT_PDF_OPTIONS } = await import("../apps/desktop/src/main/print-pdf.mjs");
  const directory = process.argv[2];
  app.setPath("userData", join(directory, "profile"));
  app.whenReady().then(async () => {
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/fixture") return response.end("<!doctype html><title>Print regression</title>");
      const path = resolve(root, "apps/web/dist", `.${decodeURIComponent(pathname)}`);
      if (!path.startsWith(join(root, "apps/web/dist/"))) { response.writeHead(403).end(); return; }
      try {
        response.setHeader("Content-Type", mime[extname(path)] ?? "application/octet-stream");
        response.end(await readFile(path));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((listen) => server.listen(0, "127.0.0.1", listen));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const opener = new BrowserWindow({ show: false });
    opener.webContents.setWindowOpenHandler(() => ({
      action: "allow", overrideBrowserWindowOptions: { show: true, width: 1000, height: 720 },
    }));
    // Keep the last window from quitting Electron before all cases finish.
    app.on("window-all-closed", () => {});
    try {
      await opener.loadURL(`${origin}/fixture`);
      for (const [name, html] of Object.entries({
        long: '<p>Before</p><p></p><p></p><p>After</p>' + Array.from({ length: 70 }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join(""),
        short: '<p>Before</p><p></p><p>After</p>',
        mixed: '<p>Before</p><p></p><p>After</p><ul><li><p>List item</p><p></p></li></ul><img width="120" height="60" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%2760%27%3E%3Crect width=%27120%27 height=%2760%27 fill=%27gray%27/%3E%3C/svg%3E"><table><tbody>' + Array.from({ length: 80 }, (_, i) => `<tr><td><p>Row ${i + 1}</p></td></tr>`).join("") + '</tbody></table>',
      })) {
        const created = new Promise((resolveWindow) => opener.webContents.once("did-create-window", resolveWindow));
        await opener.webContents.executeJavaScript(`window.preview = window.open('/note-print.html?token=regression'); void 0`);
        const preview = await created;
        await new Promise((loaded) => {
          if (!preview.webContents.isLoading()) loaded();
          else preview.webContents.once("did-finish-load", loaded);
        });
        const payload = {
          type: "edgeever:note-print", token: "regression", title: "PDF regression", notebook: "", tags: [], updatedAt: "", language: "en",
          html: `${html}<p>END-OF-NOTE</p>`,
          labels: { close: "Close", error: "Error", hint: "", preparing: "Preparing", print: "Save", ready: "Ready" },
          appearance: { palette: "native", cssVariables: {}, customCss: "", fontFamily: null, fontId: null, mermaidTheme: "zinc-light" },
        };
        await opener.webContents.executeJavaScript(`window.preview.postMessage(${JSON.stringify(payload)}, ${JSON.stringify(origin)})`);
        const metrics = await preview.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          const deadline = Date.now() + 30000;
          const check = () => {
            if (document.querySelector('#print-action').disabled) {
              if (Date.now() > deadline) return reject(new Error('Preview timeout: ' + document.querySelector('#print-status').textContent));
              return setTimeout(check, 50);
            }
            const empty = [...document.querySelectorAll('.edgeever-print-content p:empty')];
            resolve({ pages: document.querySelectorAll('.pagedjs_page').length,
              blankHeights: empty.map(p => p.getBoundingClientRect().height),
              lineHeights: empty.map(p => parseFloat(getComputedStyle(p).lineHeight)) });
          }; check();
        })`);
        assert.ok(metrics.blankHeights.length > 0);
        metrics.blankHeights.forEach((height, i) => assert.ok(height >= metrics.lineHeights[i] - 1, `${name}: empty paragraph collapsed`));
        assert.ok(name === "short" ? metrics.pages === 1 : metrics.pages > 1);
        // Real wheel input checks the scroll container rather than scrollTo alone.
        preview.focus();
        preview.webContents.focus();
        if (name !== "short") {
          let scrolled = false;
          // The OS/compositor can take a few frames to focus a newly opened window.
          for (let attempt = 0; attempt < 20 && !scrolled; attempt++) {
            preview.webContents.sendInputEvent({ type: "mouseMove", x: 400, y: 400 });
            preview.webContents.sendInputEvent({ type: "mouseWheel", x: 400, y: 400, deltaX: 0, deltaY: -300 });
            await new Promise((wait) => setTimeout(wait, 100));
            scrolled = await preview.webContents.executeJavaScript("window.scrollY > 0");
          }
          assert.ok(scrolled, `${name}: wheel must scroll`);
        }
        await writeFile(join(directory, `${name}.json`), JSON.stringify(metrics));
        await writeFile(join(directory, `${name}.pdf`), await preview.webContents.printToPDF(PRINT_PDF_OPTIONS));
        await writeFile(join(directory, `${name}.png`), (await preview.webContents.capturePage()).toPNG());
        preview.destroy();
      }
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      opener.destroy();
      server.close();
      app.exit(process.exitCode ?? 0);
    }
  }).catch((error) => { console.error(error); app.exit(1); });
}
