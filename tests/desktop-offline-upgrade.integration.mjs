// Real old/new packaged Electron applications, same isolated profile and SQLite.
// node tests/desktop-offline-upgrade.integration.mjs <old executable> <fixed executable>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const [oldExecutable, fixedExecutable] = process.argv.slice(2).map(path => resolve(path));
assert.ok(oldExecutable && fixedExecutable, "Pass old and fixed native executables");
const directory = await mkdtemp(join(tmpdir(), "edgeever-offline-transition-"));
const profile = join(directory, "profile");
const results = [];
const runtimes = {};
const observations = {};
let application, page, baseUrl, token;
const server = spawn("bun", ["tests/desktop-offline-api.mjs", directory], { stdio: ["pipe", "pipe", "inherit"] });
const control = async (mode, revoke = false) => {
  const response = await fetch(`${baseUrl}/__test/control`, { method: "POST", body: JSON.stringify({ mode, revoke }) });
  assert.equal(response.status, 200);
};
const api = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${await response.clone().text()}`);
  return response.json();
};
const launch = async executablePath => {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1" }, timeout: 60_000 });
  await expect.poll(() => application.windows().some(w => w.url().startsWith("edgeever-app://app/index.html")), { timeout: 60_000 }).toBe(true);
  page = application.windows().find(w => w.url().startsWith("edgeever-app://app/index.html"));
  await page.waitForSelector('[data-edgeever-renderer-ready="true"]', { state: "attached", timeout: 60_000 });
  const label = executablePath === oldExecutable ? "old" : "fixed";
  runtimes[label] ??= await application.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform }));
};
const close = async () => {
  if (application) await application.close();
  application = undefined;
};
const syncNow = () => application.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes("noteWindow="))?.webContents.send("desktop:command", "sync-now");
});
const local = id => page.evaluate(id => window.edgeeverDesktop.sidecarRequest("memo.get", { memoId: id }), id);
const cachedUser = () => page.evaluate(() => JSON.parse(localStorage.getItem("edgeever.desktop.session"))?.user?.id);
const credential = () => page.evaluate(() => window.edgeeverDesktop.getSessionToken());
const open = async memo => {
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByPlaceholder("Search notes").first().fill(memo.title);
  const card = page.locator(`[data-memo-id="${memo.id}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.locator("button").first().click();
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
};
const edit = async (memo, text) => {
  await open(memo);
  await page.locator('.ProseMirror[contenteditable="true"]').click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(` ${text}`);
  await expect.poll(async () => (await local(memo.id)).memo.contentMarkdown, { timeout: 30_000 }).toContain(text);
};
const record = async (name, run) => {
  await run();
  results.push({ name, ok: true });
  console.log(`PASS ${name}`);
};
try {
  baseUrl = await new Promise((resolveUrl, reject) => {
    let output = "";
    server.on("error", reject);
    server.on("exit", code => reject(new Error(`API exited ${code}`)));
    server.stdout.on("data", chunk => { output += chunk; const match = output.match(/READY (\S+)/); if (match) resolveUrl(match[1]); });
  });
  const signedIn = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "offline-test-password-only", deviceId: "offline-upgrade-test-driver" }) });
  token = signedIn.sessionToken;
  assert.ok(token);
  const notebook = (await api("/api/v1/notebooks", { method: "POST", body: JSON.stringify({ name: "Offline upgrade" }) })).notebook;
  const memo = (await api("/api/v1/memos", { method: "POST", body: JSON.stringify({ notebookId: notebook.id, title: "Offline upgrade note", contentMarkdown: "Old version original body" }) })).memo;
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "instance-url"), baseUrl);
  await writeFile(join(profile, "installation-confirmed"), "test");
  let oldCredential, userId;
  await record("released old app signs in and persists real local data", async () => {
    await launch(oldExecutable);
    await page.evaluate(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
    await page.reload();
    await page.locator('input[autocomplete="username"]').fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("offline-test-password-only");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByPlaceholder("Search notes").first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => local(memo.id).then(result => result.memo.contentMarkdown).catch(() => ""), { timeout: 60_000 }).toContain("Old version original body");
    await edit(memo, "old-version-edit");
    await syncNow();
    await expect.poll(async () => (await api(`/api/v1/memos/${memo.id}`)).memo.contentMarkdown, { timeout: 60_000 }).toContain("old-version-edit");
    oldCredential = await credential(); userId = await cachedUser();
    assert.ok(oldCredential && userId);
    await close();
  });
  await record("old version reproduces login-screen failure on HTTP 500 without deleting its local identity", async () => {
    await control("500");
    await launch(oldExecutable);
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alert")).toContainText("http_500");
    assert.equal(await credential(), oldCredential);
    assert.equal(await cachedUser(), userId);
    await page.screenshot({ path: join(directory, "old-500-login.png") });
    await close();
  });
  await record("fixed app upgrades the same old profile during HTTP 500 and reads/writes offline", async () => {
    await launch(fixedExecutable);
    await edit(memo, "fixed-offline-500-edit");
    assert.equal(await cachedUser(), userId);
    assert.equal(await credential(), oldCredential);
    const queued = await page.evaluate(() => window.edgeeverDesktop.sidecarRequest("sync.status", {}));
    assert.ok(queued.pending + queued.syncing + queued.error > 0);
    observations.outageQueue = queued;
    await page.screenshot({ path: join(directory, "fixed-500-local-edit.png") });
    await close();
  });
  await record("offline edits survive a full native restart with D1 quota HTTP 503", async () => {
    await control("503");
    await launch(fixedExecutable);
    await open(memo);
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText("fixed-offline-500-edit");
    await edit(memo, "fixed-offline-503-edit");
    assert.equal(await credential(), oldCredential);
  });
  await record("route 401 plus failed session confirmation cannot sign out the local account", async () => {
    const before = (await fetch(`${baseUrl}/__test/status`).then(r => r.json())).counters["/api/v1/auth/session"] ?? 0;
    await control("protected401");
    await page.reload();
    await open(memo);
    await syncNow();
    // One startup probe plus at least one real 401 confirmation.
    await expect.poll(async () => (await fetch(`${baseUrl}/__test/status`).then(r => r.json())).counters["/api/v1/auth/session"], { timeout: 30_000 }).toBeGreaterThan(before + 1);
    await edit(memo, "failed-confirmation-edit");
    assert.equal(await cachedUser(), userId);
    assert.equal(await credential(), oldCredential);
    await close();
  });
  await record("restoring service uploads all queued edits with the original credential", async () => {
    await control("healthy");
    await launch(fixedExecutable);
    await syncNow();
    await expect.poll(async () => (await api(`/api/v1/memos/${memo.id}`)).memo.contentMarkdown, { timeout: 90_000 }).toContain("failed-confirmation-edit");
    const remote = (await api(`/api/v1/memos/${memo.id}`)).memo.contentMarkdown;
    for (const text of ["old-version-edit", "fixed-offline-500-edit", "fixed-offline-503-edit"]) assert.ok(remote.includes(text));
    assert.equal(await credential(), oldCredential);
    observations.recoveredContent = remote;
    observations.credentialPreserved = true;
    await expect.poll(async () => {
      const state = await page.evaluate(() => window.edgeeverDesktop.sidecarRequest("sync.status", {}));
      return state.pending + state.syncing + state.error + state.conflict;
    }, { timeout: 30_000 }).toBe(0);
    observations.recoveredQueue = await page.evaluate(() => window.edgeeverDesktop.sidecarRequest("sync.status", {}));
    await open(memo);
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText("failed-confirmation-edit");
    await page.screenshot({ path: join(directory, "fixed-recovered.png") });
  });
  await record("actual session revocation requires login while running and after restart", async () => {
    await control("healthy", true);
    await syncNow();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible({ timeout: 30_000 });
    assert.equal(await credential(), "");
    await close();
    await launch(fixedExecutable);
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible({ timeout: 30_000 });
    assert.equal(await credential(), "");
    await page.locator('input[autocomplete="username"]').fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("offline-test-password-only");
    await page.locator('button[type="submit"]').click();
    await open(memo);
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toContainText("failed-confirmation-edit");
    observations.localDataPreservedAfterReauthentication = true;
    await close();
  });
} catch (error) {
  if (page) {
    console.error(await page.locator("body").innerText().catch(() => "No renderer"));
    await page.screenshot({ path: join(directory, "failure.png") }).catch(() => {});
  }
  results.push({ ok: false, error: error.stack });
  process.exitCode = 1;
  console.error(error);
} finally {
  await close().catch(() => {});
  server.stdin.end();
  await writeFile(join(directory, "results.json"), JSON.stringify({ directory, runtimes, observations, results }, null, 2));
  console.log(`Evidence: ${directory}`);
}
