import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, utimes, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runInNewContext } from "node:vm";
import { attachmentOpenInput, registerAttachmentOpenIpc } from "./attachment-open.mjs";

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = { url: "edgeever-resource://resource/res_1", filename: "训练.xlsx" };
const fixture = async (overrides = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-open-test-"));
  directories.push(directory);
  let handler;
  const opened = [];
  const reads = [];
  const options = {
    authorize: () => {}, getScope: () => "account-1", getDirectory: () => directory,
    readResource: async (url) => { reads.push(url); return new Response("attachment bytes"); },
    openPath: async (path) => { opened.push(path); return ""; },
    ...overrides,
  };
  registerAttachmentOpenIpc({ handle: (channel, value) => { expect(channel).toBe("desktop:open-attachment"); handler = value; } }, options);
  return { directory, opened, reads, options, open: (value = input) => handler({}, value) };
};

test("accepts document/media/archive types and preserves safe extensions", () => {
  for (const filename of ["训练.xlsx", "old.xls", "plan.docx", "old.doc", "slides.pptx", "report.pdf", "archive.zip", "clip.mp4", "sound.mp3", "notes.txt"]) {
    expect(attachmentOpenInput({ ...input, filename })).toEqual({ ...input, filename });
  }
  for (const filename of ["program.exe", "file.pdf.exe", "run.sh", "run.command", "run.bat", "app.desktop", "link.lnk", "setup.msi", "code.js", "file", "unknown.bin", "file.hta", "open.url"]) {
    expect(attachmentOpenInput({ ...input, filename })).toEqual({ blocked: true });
  }
  expect(attachmentOpenInput({ ...input, filename: "../../CON.xlsx" }).filename).toBe("attachment_CON.xlsx");
  expect(attachmentOpenInput({ ...input, filename: "COM¹.pdf" }).filename).toBe("attachment_COM¹.pdf");
  expect(attachmentOpenInput({ ...input, filename: "NUL .txt" }).filename).toBe("attachment_NUL.txt");
  expect(attachmentOpenInput({ ...input, filename: 'C:\\folder\\a:b?.pdf. ' }).filename).toBe("a_b_.pdf");
  expect(attachmentOpenInput({ ...input, filename: "文".repeat(200) + ".xlsx" }).filename.endsWith(".xlsx")).toBe(true);
});

test("rejects arbitrary paths, network URLs and malformed internal resource addresses", () => {
  for (const url of ["file:///etc/passwd", "https://example.org/file.xlsx", "edgeever-resource://evil/res_1", "edgeever-resource://user@resource/res_1", "edgeever-resource://resource/res_1?download=a.xlsx", "edgeever-resource://resource/res_1#x", "edgeever-resource://resource/%2fetc", "edgeever-resource://resource/%2e%2e", "edgeever-staged://pending/evil", "edgeever-staged://pending:123", "edgeever-resource://resource/%zz"]) {
    expect(attachmentOpenInput({ ...input, url })).toBeNull();
  }
});

test("streams complete bytes to a private, named copy before asking the OS to open it", async () => {
  const context = await fixture();
  expect(await context.open()).toEqual({ ok: true });
  const path = context.opened[0];
  expect(basename(path)).toBe("训练.xlsx");
  expect(await readFile(path, "utf8")).toBe("attachment bytes");
  expect(context.reads).toEqual([input.url]);
  if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  await writeFile(path, "edited externally");
  expect(await context.open()).toEqual({ ok: true });
  expect(context.opened[1]).not.toBe(path);
  expect(await readFile(path, "utf8")).toBe("edited externally");
});

test("staged attachments use the same path without requiring an HTTP URL", async () => {
  const context = await fixture();
  expect(await context.open({ url: "edgeever-staged://stage_1", filename: "offline.docx" })).toEqual({ ok: true });
  expect(context.reads).toEqual(["edgeever-staged://stage_1"]);
  expect(basename(context.opened[0])).toBe("offline.docx");
});

test("failed retrieval/offline cache misses and missing OS associations return visible error codes", async () => {
  for (const status of [401, 404, 504]) {
    const context = await fixture({ readResource: async () => new Response("missing", { status }) });
    expect(await context.open()).toEqual({ ok: false, code: "unavailable" });
    expect(context.opened).toEqual([]);
    expect(await readdir(context.directory)).toEqual([]);
  }
  const context = await fixture({ openPath: async () => "No application is associated with this file" });
  expect(await context.open()).toEqual({ ok: false, code: "open-failed" });
  expect(await readdir(context.directory)).toEqual([]);
});

test("partial downloads are never opened and their temporary files are removed", async () => {
  let chunks = 0;
  const context = await fixture({ readResource: async () => new Response(new ReadableStream({
    pull(controller) { if (++chunks === 1) controller.enqueue(new Uint8Array([1, 2])); else controller.error(new Error("Disconnected")); },
  })) });
  expect(await context.open()).toEqual({ ok: false, code: "unavailable" });
  expect(context.opened).toEqual([]);
  expect(await readdir(context.directory)).toEqual([]);
});

test("rejects unauthorized requests and blocked types before reading bytes", async () => {
  const context = await fixture();
  expect(await context.open({ ...input, filename: "run.exe" })).toEqual({ ok: false, code: "blocked" });
  context.options.authorize = () => { throw new Error("Untrusted frame"); };
  expect(await context.open()).toEqual({ ok: false, code: "forbidden" });
  expect(context.reads).toEqual([]);
});

test("rechecks account and sender after async retrieval, cancels the body and never opens another workspace's file", async () => {
  for (const changeScope of [true, false]) {
    let scope = "account-1";
    let authorized = true;
    let cancelled = false;
    const context = await fixture({
      getScope: () => scope,
      authorize: () => { if (!authorized) throw new Error("Window closed"); },
      readResource: async () => {
        if (changeScope) scope = "account-2"; else authorized = false;
        return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
      },
    });
    expect(await context.open()).toEqual({ ok: false, code: "forbidden" });
    expect(context.opened).toEqual([]);
    expect(cancelled).toBe(true);
  }
});

test("concurrent clicks open one copy, and a subsequent click can retry", async () => {
  let finish;
  let reads = 0;
  const ready = new Promise((resolve) => { finish = resolve; });
  const context = await fixture({ readResource: async () => { reads++; await ready; return new Response("bytes"); } });
  const first = context.open();
  const second = context.open();
  finish();
  expect(await first).toEqual({ ok: true });
  expect(await second).toEqual({ ok: true });
  expect(reads).toBe(1);
  expect(context.opened).toHaveLength(1);
  await context.open();
  expect(context.opened).toHaveLength(2);
});

test("cleans old copies, retaining recent copies and recently edited files", async () => {
  const context = await fixture();
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (const name of ["open-old", "open-edited", "open-recent", "unrelated"]) {
    const folder = join(context.directory, name);
    await mkdir(folder); await writeFile(join(folder, "notes.txt"), "notes");
    if (name !== "open-recent") await utimes(folder, old, old);
    if (name !== "open-edited") await utimes(join(folder, "notes.txt"), old, old);
  }
  await context.open();
  const entries = await readdir(context.directory);
  expect(entries).not.toContain("open-old");
  for (const name of ["open-edited", "open-recent", "unrelated"]) expect(entries).toContain(name);
});

test("preload only invokes attachment opening during isolated user activation", async () => {
  const source = await readFile(new URL("../preload/index.cjs", import.meta.url), "utf8");
  let bridge;
  const calls = [];
  const userActivation = { isActive: false };
  runInNewContext(source, { navigator: { userActivation }, require: () => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
    ipcRenderer: { sendSync: () => undefined, invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } },
  }) });
  expect(await bridge.openAttachment(input)).toEqual({ ok: false, code: "forbidden" });
  expect(calls).toEqual([]);
  userActivation.isActive = true;
  expect(await bridge.openAttachment(input)).toEqual({ ok: true });
  expect(calls).toEqual([["desktop:open-attachment", input]]);
});
