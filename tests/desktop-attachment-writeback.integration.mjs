// Run with Node after EDGE_EVER_DESKTOP_BUILD=1 build:web, building the sidecar and the backup
// worker. Uses the development Electron shell, an isolated profile and real API.
// Only OS launching/revealing and a temporary network outage are simulated.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const require = createRequire(resolve("apps/desktop/package.json"));
const directory = await mkdtemp(join(tmpdir(), "edgeever-writeback-desktop-"));
const profile = join(directory, "profile");
const evidence = resolve(process.argv[2] ?? "docs/changes/evidence/2026-11-04-attachment-writeback");
const webUrl = pathToFileURL(resolve("apps/web/dist/index.html")).href;
let application, server, page, baseUrl, fixtureMemoId;
const results = [];
const api = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${path}`, init);
  assert.ok(response.ok, `${path}: ${response.status}`); return response;
};
const json = async (path, value, method = "POST") => (await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) })).json();
const launch = async () => {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop"), `--user-data-dir=${profile}`],
    env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1", EDGE_EVER_API_URL: baseUrl,
      EDGE_EVER_DESKTOP_WEB_URL: webUrl, EDGE_EVER_SIDECAR_PATH: resolve("crates/desktop-sidecar/target/release/edgeever-sidecar") },
    timeout: 60_000,
  });
  await application.evaluate(({ shell, net }) => {
    globalThis.testOpened = []; globalThis.testRevealed = []; globalThis.testOffline = false;
    shell.openPath = async path => { globalThis.testOpened.push(path); return ""; };
    shell.showItemInFolder = path => globalThis.testRevealed.push(path);
    const originalFetch = net.fetch.bind(net);
    net.fetch = (url, init) => {
      if (globalThis.testOffline && init?.method === "PUT" && String(url).includes("/resources/")) throw new TypeError("Simulated network outage");
      return originalFetch(url, init);
    };
  });
  page = await application.firstWindow();
  await page.waitForSelector('[data-edgeever-renderer-ready="true"]', { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
  await page.reload();
  await page.waitForSelector('[data-edgeever-renderer-ready="true"]', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(async id => {
    const result = await window.edgeeverDesktop.sidecarRequest("memo.get", { memoId: id });
    return result.memo?.id === id;
  }, fixtureMemoId).catch(() => false), { timeout: 30_000 }).toBe(true);
  await page.getByRole("button", { name: /(?:Switch to|Current:) Writeback acceptance,/ }).click({ timeout: 30_000 });
};
try {
  await mkdir(evidence, { recursive: true }); await mkdir(profile);
  server = spawn("bun", ["tests/desktop-note-window-api.mjs", directory], { stdio: ["pipe", "pipe", "inherit"] });
  baseUrl = await new Promise((resolveUrl, reject) => {
    let output = "";
    server.on("error", reject); server.on("exit", code => reject(new Error(`API exited ${code}`)));
    server.stdout.on("data", chunk => { output += chunk; const ready = output.match(/READY (\S+)/); if (ready) resolveUrl(ready[1]); });
  });
  await writeFile(join(profile, "instance-url"), baseUrl); await writeFile(join(profile, "installation-confirmed"), "test");
  const { notebook } = await json("/notebooks", { name: "Writeback acceptance" });
  let { memo } = await json("/memos", { notebookId: notebook.id, title: "External attachment editing", contentMarkdown: "Attachment editing acceptance" });
  const form = new FormData(); form.append("file", new File(["original attachment"], "季度预算.txt", { type: "text/plain" }));
  const { resource } = await (await api(`/memos/${memo.id}/resources`, { method: "POST", body: form })).json();
  const { editSession } = await json(`/memos/${memo.id}/edit-sessions`, {});
  ({ memo } = await json(`/memos/${memo.id}`, { editSessionId: editSession.id, expectedRevision: editSession.baseRevision, expectedContentHash: editSession.baseContentHash,
    contentMarkdown: `Attachment editing acceptance\n\n[季度预算.txt](${resource.url})` }, "PATCH"));
  fixtureMemoId = memo.id;
  const cloudText = async () => (await api(`/resources/${resource.id}/blob`, { cache: "no-store" })).text();
  await launch();
  await page.getByPlaceholder("Search notes").first().fill(memo.title);
  const card = page.locator(`[data-memo-id="${memo.id}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 }); await card.locator("button").first().click();
  const openLink = page.getByRole("link", { name: "Open externally", exact: true });
  await expect(openLink).toBeVisible({ timeout: 30_000 }); await openLink.click();
  await expect.poll(() => application.evaluate(() => globalThis.testOpened.length), { timeout: 15_000 }).toBe(1);
  const localPath = await application.evaluate(() => globalThis.testOpened[0]);
  assert.equal(await readFile(localPath, "utf8"), "original attachment");
  await writeFile(localPath, "saved through external editing");
  await expect.poll(cloudText, { timeout: 20_000 }).toBe("saved through external editing");
  await expect.poll(() => page.evaluate(id => window.edgeeverDesktop.readResource(id).then(file => new TextDecoder().decode(file.bytes)), resource.id)).toBe("saved through external editing");
  await expect(page.locator(".edgeever-file-viewer")).toContainText(`${Buffer.byteLength("saved through external editing")} B`);
  await page.getByRole("button", { name: "Attachment writeback", exact: true }).click();
  await expect(page.getByText("Synced to the original attachment", { exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog && getComputedStyle(dialog).opacity === "1" && dialog.getAnimations().every(animation => animation.playState !== "running");
  });
  await page.screenshot({ path: join(evidence, "saved.png") });
  await page.getByRole("button", { name: "Show local file", exact: true }).click();
  assert.deepEqual(await application.evaluate(() => globalThis.testRevealed), [localPath]);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await openLink.click();
  await expect.poll(() => application.evaluate(() => globalThis.testOpened.length)).toBe(2);
  const reopened = await application.evaluate(() => globalThis.testOpened[1]);
  assert.notEqual(reopened, localPath); assert.equal(await readFile(reopened, "utf8"), "saved through external editing");
  results.push("renderer open action → watched copy → real API replacement → refreshed desktop bytes → fresh reopening → reveal action");

  await application.evaluate(() => { globalThis.testOffline = true; });
  await writeFile(localPath, "offline edit recovered after restarting EdgeEver");
  await expect.poll(() => page.evaluate(() => window.edgeeverDesktop.attachmentWritebacks().then(items => items.some(item => item.status === "error"))), { timeout: 20_000 }).toBe(true);
  await application.close(); application = null;
  await launch();
  await expect.poll(cloudText, { timeout: 45_000 }).toBe("offline edit recovered after restarting EdgeEver");
  await expect(page.locator(".edgeever-file-viewer")).toContainText(`${Buffer.byteLength("offline edit recovered after restarting EdgeEver")} B`);
  results.push("offline pending snapshot survives an actual Electron restart and resumes in the original account, including displayed file metadata");

  const latest = (await (await api("/resources")).json()).resources.find(item => item.id === resource.id);
  const competing = new FormData(); competing.append("file", new File(["another device's edit"], "季度预算.txt", { type: "text/plain" })); competing.append("expectedContentHash", latest.sha256);
  await api(`/resources/${resource.id}/blob`, { method: "PUT", body: competing });
  await writeFile(localPath, "conflicting local changes");
  await expect.poll(() => page.evaluate(() => window.edgeeverDesktop.attachmentWritebacks().then(items => items.some(item => item.status === "conflict"))), { timeout: 20_000 }).toBe(true);
  await page.getByRole("button", { name: /Unsynced attachments ·/ }).click();
  await expect(page.getByText("The original attachment changed. Your local edits are kept; neither version was overwritten.")).toBeVisible();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog && getComputedStyle(dialog).opacity === "1" && dialog.getAnimations().every(animation => animation.playState !== "running");
  });
  await page.screenshot({ path: join(evidence, "conflict.png") });
  assert.equal(await cloudText(), "another device's edit"); assert.equal(await readFile(localPath, "utf8"), "conflicting local changes");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.edgeeverDesktop.attachmentWritebacks().then(items => items.some(item => item.status === "conflict")))).toBe(true);
  assert.equal(await cloudText(), "another device's edit");
  results.push("competing device causes a visible conflict; local edits survive and Retry never forces an overwrite");
  await writeFile(join(evidence, "results.json"), JSON.stringify({ platform: process.platform, baseline: "6be20cfc", results, limitations: ["OS launching/revealing and network outage are simulated", "No Windows Excel/WPS or old-release upgrade acceptance"] }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, results, evidence }, null, 2));
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => document.body.innerText.slice(0, 3500)).catch(() => "No renderer"));
    await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
  server?.stdin.end();
  if (server && server.exitCode === null) await new Promise(resolveExit => server.once("exit", resolveExit));
  await rm(directory, { recursive: true, force: true });
}
