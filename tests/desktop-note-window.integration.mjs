// Packaged desktop E2E for "open a note in a new window" (#67, #730).
// Usage: node tests/desktop-note-window.integration.mjs <packaged executable>
// Renderer changes can be checked before packaging: with `bun run dev`
// running, set EDGE_EVER_DESKTOP_WEB_URL=http://127.0.0.1:5173 so an existing
// packaged app loads the local renderer.
// Starts the test API (tests/desktop-note-window-api.mjs, under Bun) on a
// temporary SQLite database, launches the packaged app against it and drives
// the main window and note windows. The driver runs under Node because
// Playwright cannot open its Electron connection from Bun 1.3.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { desktopMenuCopy } from "../apps/desktop/src/main/desktop-menu.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(process.argv[2], "Pass the locally built desktop executable as the first argument.");
const executablePath = resolve(process.argv[2]);
const only = process.argv[3]?.split(",") ?? null;
const directory = await mkdtemp(join(tmpdir(), "edgeever-note-window-e2e-"));
const profile = join(directory, "profile");
const results = [];
let application;
let server;
let page;
let note;
let baseUrl;

// Pausing storage simulates a sidecar that stops answering. Only this test's
// sidecar is matched, by its data directory.
const sidecarPids = () => {
  try {
    return execFileSync("pgrep", ["-f", `edgeever-sidecar --data-dir ${profile}`]).toString().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
const signalSidecars = (signal) => {
  for (const pid of sidecarPids()) {
    try { process.kill(Number(pid), signal); } catch {}
  }
};

// Pausing storage relies on POSIX signals; Windows runs the other scenarios.
const pausesStorage = new Set(["D1", "E1"]);
// A timed-out scenario keeps running against the shared app, so later steps cannot trust its state.
let timedOut = false;
const step = async (name, run) => {
  if (only && !only.includes(name.split(":")[0])) return;
  if (timedOut) {
    console.log(`SKIP ${name} (an earlier scenario timed out)`);
    return;
  }
  if (process.platform === "win32" && pausesStorage.has(name.split(":")[0])) {
    console.log(`SKIP ${name} (needs POSIX signals)`);
    return;
  }
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("step timeout"));
        }, 180_000);
      }),
    ]);
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    signalSidecars("SIGCONT");
    results.push({ name, ok: false, error: String(error?.message || error).split("\n").slice(0, 6).join(" | ") });
  } finally {
    clearTimeout(timer);
  }
  const result = results.at(-1);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${name}${result.ok ? ` (${result.ms} ms)` : `: ${result.error}`}`);
};

const api = async (path, init) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
};
let notebookId;
const createMemo = async (title, contentMarkdown) =>
  (await api("/api/v1/memos", { method: "POST", body: JSON.stringify({ notebookId, title, contentMarkdown }) })).memo;
// A one-column table note in the stored table format (packages/shared/src/table.ts).
const tableMarkdown = (cell) => {
  const document = { schemaVersion: 1, fields: [{ id: "fld_name", name: "Name", type: "text" }], records: [{ id: "rec_sample", cells: { fld_name: cell } }], view: { filters: [], sort: null } };
  return `| Name |\n| --- |\n| ${cell} |\n\n<!-- edgeever-table-v1:${Buffer.from(JSON.stringify(document)).toString("base64url")} -->`;
};
const serverMarkdown = async (id) => (await api(`/api/v1/memos/${id}`)).memo.contentMarkdown;
// An edit made on another device: through the API with its own edit session.
const editOnServer = async (id, suffix) => {
  const { memo } = await api(`/api/v1/memos/${id}`);
  const { editSession } = await api(`/api/v1/memos/${id}/edit-sessions`, { method: "POST" });
  await api(`/api/v1/memos/${id}`, { method: "PATCH", body: JSON.stringify({
    editSessionId: editSession.id,
    expectedRevision: editSession.baseRevision,
    expectedContentHash: editSession.baseContentHash,
    contentMarkdown: `${memo.contentMarkdown}\n\n${suffix}`,
  }) });
};

// Hosted Windows runners have a 1024x768 screen, which leaves the window below
// the 1024px desktop layout; a smaller scale factor gives it the desktop layout.
const displayArgs = process.platform === "win32" ? ["--force-device-scale-factor=0.75"] : [];
const launch = async () => {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, ...displayArgs],
    env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1" },
    timeout: 60_000,
  });
  // Startup can briefly open a renderer-origin migration window before the main window.
  const deadline = Date.now() + 60_000;
  let main;
  while (Date.now() < deadline && !main) {
    main = application.windows().find((window) => (
      window.url().startsWith("edgeever-app://app/index.html") ||
      // Local debugging: the packaged app loads the renderer from `bun run dev`.
      (Boolean(process.env.EDGE_EVER_DESKTOP_WEB_URL) && window.url().startsWith(process.env.EDGE_EVER_DESKTOP_WEB_URL)) ||
      (process.env.EDGE_EVER_FORCE_FILE_RENDERER === "1" && /^file:.*\/web\/index\.html/.test(window.url()))
    ) && !window.url().includes("noteWindow="));
    if (!main) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert.ok(main, "The packaged main window must open");
  await main.waitForSelector('[data-edgeever-renderer-ready="true"]', { state: "attached", timeout: 60_000 });
  await main.evaluate(() => localStorage.setItem("edgeever.locale.preference", "en-US"));
  await main.reload();
  await main.waitForSelector('[data-edgeever-renderer-ready="true"]', { state: "attached", timeout: 60_000 });
  page = main;
  note = undefined;
  // Wait until the first sync brought the test notebook into local storage.
  // The sidecar can still be starting right after the reload.
  await expect.poll(() => page.evaluate(async (id) => {
    const { notebooks } = await window.edgeeverDesktop.sidecarRequest("notebook.list");
    return notebooks.some((notebook) => notebook.id === id);
  }, notebookId).catch(() => false), { timeout: 60_000 }).toBe(true);
  // Search covers the selected notebook, and a seeded demo notebook is selected first.
  await page.getByRole("button", { name: "All notes", exact: true }).click({ timeout: 30_000 }).catch(async (error) => {
    await reportStartupState();
    throw error;
  });
};

// Print what the main window shows when startup does not reach the notes list.
const reportStartupState = async () => {
  const state = await page.evaluate(() => ({
    size: `${window.innerWidth}x${window.innerHeight}`,
    locale: document.documentElement.lang,
    buttons: [...document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") || button.innerText.trim()).filter(Boolean).slice(0, 40),
    text: document.body.innerText.slice(0, 1500),
  })).catch((error) => ({ error: String(error) }));
  console.log("Main window at startup failure:", JSON.stringify(state, null, 2));
  if (process.env.EDGE_EVER_E2E_SCREENSHOT) await page.screenshot({ path: process.env.EDGE_EVER_E2E_SCREENSHOT }).catch(() => undefined);
};

const noteWindowPage = async (memoId, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = application.windows().find((window) => window.url().includes(`noteWindow=${memoId}`));
    if (found) return found;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return null;
};
const noteWindowCount = () => application.windows().filter((window) => window.url().includes("noteWindow=")).length;
const waitForNoteWindowClosed = async (memoId, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!application.windows().some((window) => window.url().includes(`noteWindow=${memoId}`))) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("note window did not close");
};
const focusedUrl = () => application.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getFocusedWindow();
  return window && !window.isDestroyed() && !window.webContents.isDestroyed()
    ? window.webContents.getURL() : null;
});
const focusMain = async () => {
  await application.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.getURL().includes("noteWindow="));
    main.show();
    main.focus();
  });
  // OS focus changes are asynchronous. The application menu ignores this
  // command while a note window is still focused, so wait before invoking it.
  await expect.poll(focusedUrl).toMatch(/index\.html$/);
};
const syncNow = () => application.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.getURL().includes("noteWindow="))
    .webContents.send("desktop:command", "sync-now");
});
const closeWindowLikeUser = (memoId) => application.evaluate(({ BrowserWindow }, id) => {
  BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.getURL().includes(`noteWindow=${id}`))?.close();
}, memoId);
// The application menu follows the OS language, not the app language.
const menuLabels = (key) => ["en-US", "zh-CN", "ja", "pl", "ru"].map((locale) => desktopMenuCopy(locale)[key]).filter(Boolean);
const clickMenuItem = (key) => application.evaluate(({ Menu }, labels) => {
  const find = (items) => {
    for (const item of items) {
      if (labels.includes(item.label)) return item;
      const nested = item.submenu && find(item.submenu.items);
      if (nested) return nested;
    }
    return null;
  };
  const item = find(Menu.getApplicationMenu().items);
  if (!item) throw new Error(`menu item ${labels[0]} missing`);
  item.click();
}, menuLabels(key));

const noteEditor = () => note.locator(".ProseMirror[contenteditable='true']");
const mainEditor = () => page.locator(".ProseMirror[contenteditable='true']");
const typeAtEnd = async (target, editor, text) => {
  await editor.click();
  await target.keyboard.press("ControlOrMeta+End");
  await target.keyboard.type(text);
};
const openInMain = async (memo) => {
  await page.getByPlaceholder("Search notes").first().fill(memo.title);
  const card = page.locator(`[data-memo-id="${memo.id}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.locator("button").first().click();
  await expect(mainEditor()).toContainText(memo.contentMarkdown.split("\n")[0], { timeout: 20_000 });
  return mainEditor();
};
const chooseOpenInNewWindow = async () => {
  await page.getByRole("button", { name: "More note actions" }).click({ timeout: 15_000 });
  await page.getByRole("menuitem", { name: "Open in new window" }).click({ timeout: 15_000 });
};
const closeNotice = async () => {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /OK|Close|Got it/i }).first().click({ timeout: 2_000 }).catch(() => undefined);
};
const outboxStatuses = (memoId) => page.evaluate(async (id) => {
  const { items } = await window.edgeeverDesktop.sidecarRequest("sync.outbox.list", { limit: 200, includeConflicts: true });
  return items.filter((item) => item.entityId === id).map((item) => item.status);
}, memoId);

try {
  server = spawn("bun", ["tests/desktop-note-window-api.mjs", directory], { stdio: ["pipe", "pipe", "inherit"] });
  baseUrl = await new Promise((resolveUrl, reject) => {
    let output = "";
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`test API exited with code ${code}`)));
    server.stdout.on("data", (chunk) => {
      output += chunk;
      const ready = output.match(/READY (\S+)/);
      if (ready) resolveUrl(ready[1]);
    });
  });
  notebookId = (await api("/api/v1/notebooks", { method: "POST", body: JSON.stringify({ name: "Note windows" }) })).notebook.id;
  const memoA = await createMemo("Window A", "Alpha body");
  const memoB = await createMemo("Window B", "Bravo body");
  const memoC = await createMemo("Window C", "Charlie body");
  const memoD = await createMemo("Window D", "Delta body");
  const memoE = await createMemo("Window E", "Echo body");
  const memoTable = await createMemo("Window Table", tableMarkdown("Tango row"));

  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "instance-url"), baseUrl);
  await writeFile(join(profile, "installation-confirmed"), "test");
  await launch();

  const verifyPdfExport = async (target, clickExport, expectedTitle, expectedText) => {
    const dialogs = [];
    let preview;
    const onDialog = async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); };
    target.on("dialog", onDialog);
    try {
      const opened = application.waitForEvent("window", { timeout: 15_000 });
      [preview] = await Promise.all([
        opened.catch((error) => { throw new Error(`PDF window did not open; alerts: ${dialogs.join("; ")}`, { cause: error }); }),
        clickExport(),
      ]);
      await preview.waitForURL(/note-print\.html\?token=/, { timeout: 20_000 });
      preview.on("console", (message) => { if (message.type() === "error") console.log("Print renderer:", message.text()); });
      preview.on("pageerror", (error) => console.log("Print renderer:", error.message));
      await expect(preview.locator("#print-action")).toBeEnabled({ timeout: 30_000 });
      await expect(preview.locator(".edgeever-print-content")).toContainText(expectedText);
      await expect(preview.locator(".edgeever-print-title")).toContainText(expectedTitle);
      const path = join(directory, `${expectedTitle.replace(/\W/g, "_")}.pdf`);
      // Electron owns the save dialog. Select a temporary destination while
      // retaining the real renderer -> IPC -> Chromium -> download path.
      await application.evaluate(({ session }, savePath) => {
        globalThis.__edgeeverPrintDownloadState = "waiting";
        session.defaultSession.once("will-download", (_event, item) => {
          item.setSavePath(savePath);
          item.once("done", (_doneEvent, state) => { globalThis.__edgeeverPrintDownloadState = state; });
        });
      }, path);
      await preview.locator("#print-action").click();
      await expect.poll(() => application.evaluate(() => globalThis.__edgeeverPrintDownloadState), { timeout: 30_000 }).toBe("completed");
      const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = getDocument({ data: new Uint8Array(await readFile(path)) });
      const pdf = await task.promise;
      let text = "";
      for (let number = 1; number <= pdf.numPages; number++) {
        text += (await (await pdf.getPage(number)).getTextContent()).items.map((item) => item.str ?? "").join(" ");
      }
      await task.destroy();
      assert.ok(text.includes(expectedText), "the downloaded PDF must contain the chosen note");
      assert.deepEqual(dialogs, [], "PDF export must not show a popup-blocked alert");
    } finally {
      await preview?.close().catch(() => undefined);
      target.off("dialog", onDialog);
    }
  };

  await step("P1: editor menu exports the current note to a readable PDF", async () => {
    await openInMain(memoA);
    await verifyPdfExport(page, async () => {
      await page.getByRole("button", { name: "More note actions" }).click();
      await page.getByRole("menuitem", { name: "Export PDF", exact: true }).click();
    }, memoA.title, "Alpha body");
  });

  await step("P2: list context menu loads and exports a different note", async () => {
    await openInMain(memoA);
    await page.getByPlaceholder("Search notes").first().fill("");
    const card = page.locator(`[data-memo-id="${memoB.id}"]`).first();
    await expect(card).toBeVisible();
    await card.click({ button: "right" });
    await verifyPdfExport(page, () => page.getByRole("menuitem", { name: "Export PDF", exact: true }).click(), memoB.title, "Bravo body");
  });

  await step("T1: saving a note as a template keeps the editor usable", async () => {
    await openInMain(memoA);
    await page.getByPlaceholder("Search notes").first().fill("");
    const listTemplates = () => page.evaluate(async () =>
      (await window.edgeeverDesktop.sidecarRequest("template.list", {})).templates
    );
    const initialCount = (await listTemplates()).length;
    const openNameDialog = async () => {
      await page.locator(`[data-memo-id="${memoB.id}"]`).first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Save as template", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox") });
      await expect(dialog.getByRole("textbox")).toHaveValue(memoB.title);
      return dialog;
    };

    const cancelled = await openNameDialog();
    await cancelled.getByRole("textbox").fill("   ");
    await expect(cancelled.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await cancelled.getByRole("button", { name: "Cancel" }).click();
    await expect(cancelled).toBeHidden();
    assert.equal((await listTemplates()).length, initialCount);

    const dialog = await openNameDialog();
    await dialog.getByRole("textbox").fill("  Bravo template  ");
    await dialog.getByRole("textbox").press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await listTemplates())
      .filter((template) => template.name === "Bravo template")
      .map((template) => template.contentMarkdown)).toEqual([memoB.contentMarkdown]);
    assert.equal((await listTemplates()).length, initialCount + 1);
    await expect(mainEditor()).toContainText(memoB.contentMarkdown);
    await closeNotice();
  });

  await step("T2: a reading-protected note can be saved as a template from the list", async () => {
    await openInMain(memoB);
    await page.getByRole("button", { name: /^Enable reading protection/ }).click();
    const unlock = page.getByRole("button", { name: /^Disable reading protection/ });
    await expect(unlock).toHaveAttribute("aria-pressed", "true");
    try {
      await page.locator(`[data-memo-id="${memoB.id}"]`).first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Save as template", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Save as template" });
      await expect(dialog.getByRole("textbox")).toHaveValue(memoB.title);
      await dialog.getByRole("textbox").fill("Protected note template");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toBeHidden();
      await closeNotice();
      await expect(unlock).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await api("/api/v1/templates")).templates
        .filter((t) => t.name === "Protected note template")
        .map((t) => t.contentMarkdown), { timeout: 30_000 }).toEqual([memoB.contentMarkdown]);
    } finally {
      await unlock.click();
    }
  });

  await step("T3: a table note can be saved as a template from the list", async () => {
    await openInMain(memoA);
    await page.getByPlaceholder("Search notes").first().fill("");
    const listTemplates = () => page.evaluate(async () =>
      (await window.edgeeverDesktop.sidecarRequest("template.list", {})).templates
    );
    const initialCount = (await listTemplates()).length;
    const openNameDialog = async () => {
      await page.locator(`[data-memo-id="${memoTable.id}"]`).first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Save as template", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Save as template" });
      await expect(dialog.getByRole("textbox")).toHaveValue(memoTable.title);
      return dialog;
    };

    // From a text note: the table note opens, then the name dialog shows.
    const dialog = await openNameDialog();
    await dialog.getByRole("textbox").fill("Table template");
    await dialog.getByRole("textbox").press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await listTemplates())
      .filter((template) => template.name === "Table template")
      .map((template) => template.contentMarkdown.includes("<!-- edgeever-table-v1:") && template.contentMarkdown.includes("Tango row")))
      .toEqual([true]);
    assert.equal((await listTemplates()).length, initialCount + 1);
    await closeNotice();

    // Again while the table note is already open; cancelling writes nothing.
    const cancelled = await openNameDialog();
    await cancelled.getByRole("button", { name: "Cancel" }).click();
    await expect(cancelled).toBeHidden();
    assert.equal((await listTemplates()).length, initialCount + 1);
  });

  await step("P3: independent note window exports with the same print policy", async () => {
    await openInMain(memoA);
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id);
    assert.ok(note, "note window opened");
    await expect(noteEditor()).toContainText("Alpha body");
    await verifyPdfExport(note, async () => {
      await note.getByRole("button", { name: "More note actions" }).click();
      await note.getByRole("menuitem", { name: "Export PDF", exact: true }).click();
    }, memoA.title, "Alpha body");
    await closeWindowLikeUser(memoA.id);
    await waitForNoteWindowClosed(memoA.id);
  });

  await step("A1: unsaved edits move with the note to its new window", async () => {
    await typeAtEnd(page, await openInMain(memoA), " typed-before-move");
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id);
    assert.ok(note, "note window opened");
    await expect(noteEditor()).toContainText("typed-before-move", { timeout: 20_000 });
    await expect(page.getByTestId("note-in-separate-window")).toBeVisible();
    await expect(mainEditor()).toHaveCount(0);
    assert.equal(noteWindowCount(), 1);
  });

  await step("A2: opening the note again from any entry focuses the same window", async () => {
    assert.deepEqual(await page.evaluate((id) => window.edgeeverDesktop.openNoteWindow(id), memoA.id), { opened: false });
    await focusMain();
    await clickMenuItem("openNoteWindow");
    await expect.poll(focusedUrl).toContain(`noteWindow=${memoA.id}`);
    await focusMain();
    await page.locator(`[data-memo-id="${memoA.id}"]`).first().locator("button").first().click();
    await expect.poll(focusedUrl).toContain(`noteWindow=${memoA.id}`);
    await focusMain();
    await page.getByRole("button", { name: "Show window" }).click();
    await expect.poll(focusedUrl).toContain(`noteWindow=${memoA.id}`);
    assert.equal(noteWindowCount(), 1);
  });

  await step("A3: a note window cannot open other note windows, switch accounts or change the instance", async () => {
    await assert.rejects(note.evaluate((id) => window.edgeeverDesktop.openNoteWindow(id), memoB.id));
    await assert.rejects(note.evaluate(() => window.edgeeverDesktop.setAccountScope("someone-else")));
    await assert.rejects(note.evaluate(() => window.edgeeverDesktop.setApiBaseUrl("http://127.0.0.1:1")));
    assert.equal((await note.evaluate(() => window.edgeeverDesktop.noteWindows())).length, 0);
  });

  await step("B1: closing the note window saves pending edits and returns the note", async () => {
    await typeAtEnd(note, noteEditor(), " typed-in-window");
    await closeWindowLikeUser(memoA.id);
    await waitForNoteWindowClosed(memoA.id);
    await expect(page.getByTestId("note-in-separate-window")).toHaveCount(0, { timeout: 10_000 });
    await expect(mainEditor()).toContainText("typed-in-window", { timeout: 20_000 });
    await syncNow();
    await expect.poll(() => serverMarkdown(memoA.id), { timeout: 60_000 }).toContain("typed-in-window");
    assert.match(await serverMarkdown(memoA.id), /typed-before-move/);
  });

  await step("C1: two notes can each have their own window, and links open in the main window", async () => {
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id);
    await expect(noteEditor()).toContainText("typed-in-window", { timeout: 20_000 });
    assert.equal(await note.evaluate((id) => window.edgeeverDesktop.openMemoInMainWindow(id), memoB.id), true);
    await expect(mainEditor()).toContainText("Bravo body", { timeout: 20_000 });
    await chooseOpenInNewWindow();
    assert.ok(await noteWindowPage(memoB.id));
    assert.equal(noteWindowCount(), 2);
    // Closing right after opening must work too.
    await closeWindowLikeUser(memoB.id);
    await waitForNoteWindowClosed(memoB.id);
    assert.equal(noteWindowCount(), 1);
  });

  await step("D1: if saving before the move fails, the note stays in the main window", async () => {
    await closeWindowLikeUser(memoA.id);
    await waitForNoteWindowClosed(memoA.id);
    const editor = await openInMain(memoA);
    signalSidecars("SIGSTOP");
    try {
      await typeAtEnd(page, editor, " typed-while-storage-down");
      await chooseOpenInNewWindow();
      await expect(page.getByText("couldn't be saved, so it stays in this window")).toBeVisible({ timeout: 60_000 });
      assert.equal(noteWindowCount(), 0);
      await expect(mainEditor()).toContainText("typed-while-storage-down");
    } finally {
      signalSidecars("SIGCONT");
    }
    await closeNotice();
  });

  await step("E1: if saving on close fails, the window stays open; closing again keeps the draft", async () => {
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id, 60_000);
    await expect(noteEditor()).toContainText("typed-while-storage-down", { timeout: 20_000 });
    signalSidecars("SIGSTOP");
    try {
      await typeAtEnd(note, noteEditor(), " draft-only-edit");
      await closeWindowLikeUser(memoA.id);
      await expect(note.getByRole("alert")).toContainText("couldn't be saved", { timeout: 60_000 });
      assert.equal(noteWindowCount(), 1);
      await closeWindowLikeUser(memoA.id);
      await waitForNoteWindowClosed(memoA.id);
    } finally {
      signalSidecars("SIGCONT");
    }
    await expect(mainEditor()).toContainText("draft-only-edit", { timeout: 30_000 });
  });

  await step("F1: quitting saves the open note window; windows are not restored", async () => {
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id);
    await expect(noteEditor()).toContainText("Alpha body", { timeout: 20_000 });
    await typeAtEnd(note, noteEditor(), " typed-before-quit");
    const nativeProcess = application.process();
    await application.evaluate(({ app }) => app.quit());
    await application.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
    // The debugging connection can close before Windows releases the process
    // and its single-instance lock. Relaunch only after the native process exits.
    await expect.poll(() => nativeProcess.exitCode !== null || nativeProcess.signalCode !== null, { timeout: 30_000 }).toBe(true);
    await launch();
    assert.equal(noteWindowCount(), 0, "note windows are not restored after a restart");
    await openInMain(memoA);
    await expect(mainEditor()).toContainText("typed-before-quit", { timeout: 20_000 });
  });

  await step("G1: deleting the note in its window closes the window", async () => {
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoA.id);
    await expect(noteEditor()).toBeVisible({ timeout: 20_000 });
    await note.getByRole("button", { name: "More note actions" }).click({ timeout: 15_000 });
    await note.getByRole("menuitem", { name: /Move to trash|Delete/ }).first().click({ timeout: 15_000 });
    await note.getByRole("button", { name: /Move to trash|Delete/ }).last().click({ timeout: 3_000 }).catch(() => undefined);
    await waitForNoteWindowClosed(memoA.id);
    await expect(page.locator(`[data-memo-id="${memoA.id}"]`)).toHaveCount(0, { timeout: 30_000 });
  });

  await step("H1: a crashed note window gives the note back to the main window with a message", async () => {
    await openInMain(memoD);
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoD.id);
    await expect(noteEditor()).toContainText("Delta body", { timeout: 20_000 });
    await application.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.getURL().includes(`noteWindow=${id}`)).webContents.forcefullyCrashRenderer();
    }, memoD.id);
    await waitForNoteWindowClosed(memoD.id);
    await expect(page.getByText("closed unexpectedly")).toBeVisible({ timeout: 20_000 });
    await closeNotice();
    await expect(page.getByTestId("note-in-separate-window")).toHaveCount(0, { timeout: 10_000 });
    await expect(mainEditor()).toContainText("Delta body", { timeout: 20_000 });
  });

  await step("H2: a note the window cannot show is reported and leaves no window", async () => {
    await assert.rejects(page.evaluate(() => window.edgeeverDesktop.openNoteWindow("memo_does_not_exist")), /note-unavailable/);
    await waitForNoteWindowClosed("memo_does_not_exist");
    assert.deepEqual(await page.evaluate(() => window.edgeeverDesktop.noteWindows()), []);
  });

  await step("I1: a change made on another device reaches the open note window after sync", async () => {
    await openInMain(memoE);
    await chooseOpenInNewWindow();
    note = await noteWindowPage(memoE.id);
    await expect(noteEditor()).toContainText("Echo body", { timeout: 20_000 });
    await editOnServer(memoE.id, "remote-edit-one");
    await syncNow();
    await expect(noteEditor()).toContainText("remote-edit-one", { timeout: 40_000 });
  });

  await step("I2: a sync conflict reaches the note window as it reaches the main window", async () => {
    await editOnServer(memoE.id, "remote-edit-two");
    // Typing saves locally on the old revision; the main window's sync then conflicts.
    await typeAtEnd(note, noteEditor(), " local-edit-two");
    await note.waitForTimeout(4_000);
    await syncNow();
    await expect(noteEditor()).toContainText("remote-edit-two", { timeout: 40_000 });
    await expect.poll(() => outboxStatuses(memoE.id), { timeout: 40_000 }).toContain("conflict");
  });
} finally {
  signalSidecars("SIGCONT");
  let closeTimer;
  await Promise.race([
    application?.close().catch(() => undefined),
    new Promise((resolveWait) => { closeTimer = setTimeout(resolveWait, 20_000); }),
  ]);
  clearTimeout(closeTimer);
  // Windows keeps the database locked until the API process has exited.
  if (server && server.exitCode === null) {
    const exited = new Promise((resolveExit) => server.once("exit", resolveExit));
    server.stdin.end();
    let killTimer;
    await Promise.race([exited, new Promise((resolveWait) => { killTimer = setTimeout(resolveWait, 10_000); })]);
    clearTimeout(killTimer);
    if (server.exitCode === null) {
      server.kill();
      await exited;
    }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((result) => !result.ok);
console.log(`Packaged note windows: ${results.length - failed.length}/${results.length} scenarios passed.`);
if (failed.length || !results.length) process.exit(1);
