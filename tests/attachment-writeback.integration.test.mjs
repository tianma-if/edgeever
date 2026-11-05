import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { registerAttachmentOpenIpc } from "../apps/desktop/src/main/attachment-open.mjs";
import { createAttachmentWritebackManager, replaceAttachmentResource } from "../apps/desktop/src/main/attachment-writeback.mjs";

// Real SQLite, blob storage and shared API, with only the OS launch stubbed.
test("opening, external saves, restart recovery and competing-device edits use the real resource API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-writeback-api-"));
  const database = new Database(join(directory, "database.sqlite"));
  try {
    for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", name), "utf8"));
    database.query("INSERT OR IGNORE INTO workspaces(id,name,is_personal) VALUES ('ws_default','Personal',1)").run();
    const environment = { storage: createSelfHostedStorageAdapter(database, join(directory, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
    const api = (path, init = {}) => fetchEdgeEverApp(new Request(`http://local.test/api/v1${path}`, init), environment, { waitUntil() {}, passThroughOnException() {} });
    const post = async (path, value) => {
      const response = await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      expect(response.ok).toBe(true); return response.json();
    };
    const { notebook } = await post("/notebooks", { name: "Attachment editing" });
    const { memo } = await post("/memos", { notebookId: notebook.id, title: "Writeback", contentMarkdown: "Attachment" });
    const form = new FormData(); form.append("file", new File(["original"], "预算.txt", { type: "text/plain" }));
    const upload = await api(`/memos/${memo.id}/resources`, { method: "POST", body: form });
    expect(upload.status).toBe(201);
    const { resource } = await upload.json();
    let now = Date.now(); let offline = false; let loseResponse = false;
    const uploaded = [];
    const options = {
      getContext: () => ({ key: "isolated-account", directory: join(directory, "opened-attachments") }),
      now: () => now,
      resolveResourceId: async () => resource.id,
      replace: input => replaceAttachmentResource(async (path, init, assertCurrent) => {
        assertCurrent();
        if (offline) throw new TypeError("Network unavailable");
        const response = await api(path, init);
        if (loseResponse && response.ok && init.method === "PUT") { loseResponse = false; throw new TypeError("Response lost"); }
        return response;
      }, input),
      onSaved: async value => uploaded.push(value.resource),
    };
    let manager = createAttachmentWritebackManager(options);
    const opened = [];
    let openAttachment;
    registerAttachmentOpenIpc({ handle: (_channel, handler) => { openAttachment = handler; } }, {
      authorize() {}, getScope: () => "isolated-account", getDirectory: () => options.getContext().directory,
      readResource: async () => api(`/resources/${resource.id}/blob`, { cache: "no-store" }),
      openPath: async path => { opened.push(path); return ""; }, writeback: manager,
    });
    expect(await openAttachment({}, { url: `edgeever-resource://resource/${resource.id}`, filename: "预算.txt" })).toEqual({ ok: true });
    const settle = async () => { await manager.tick(); now += 2000; await manager.tick(); };
    await writeFile(opened[0], "first saved edit"); await settle();
    // A different client reads the same resource ID, not a new uploaded attachment.
    expect(await (await api(`/resources/${resource.id}/blob`, { cache: "no-store" })).text()).toBe("first saved edit");
    expect(uploaded[0].id).toBe(resource.id);
    expect(uploaded[0].filename).toBe("预算.txt");
    offline = true;
    await writeFile(opened[0], "offline edit"); await settle();
    manager.suspend(); manager = createAttachmentWritebackManager(options);
    offline = false; now += 31_000; loseResponse = true;
    await settle();
    now += 31_000; await settle();
    expect((await manager.list())[0].status).toBe("saved");
    expect(await (await api(`/resources/${resource.id}/blob`)).text()).toBe("offline edit");
    // Another device wins first; the local copy must survive without overwriting it.
    const resourceRow = database.query("SELECT sha256 FROM resources WHERE id = ?").get(resource.id);
    const other = new FormData(); other.append("file", new File(["other device"], "预算.txt", { type: "text/plain" })); other.append("expectedContentHash", resourceRow.sha256);
    expect((await api(`/resources/${resource.id}/blob`, { method: "PUT", body: other })).ok).toBe(true);
    await writeFile(opened[0], "conflicting local edit"); await settle();
    expect((await manager.list())[0].status).toBe("conflict");
    expect(await (await api(`/resources/${resource.id}/blob`)).text()).toBe("other device");
    expect(await readFile(opened[0], "utf8")).toBe("conflicting local edit");
    const orphan = join(directory, "opened-attachments", "open-legacy"); await mkdir(orphan); await writeFile(join(orphan, "old.txt"), "old untracked edits");
    manager.suspend(); manager = createAttachmentWritebackManager(options); await settle();
    expect(await manager.list()).toHaveLength(1);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);

test("older servers cannot receive automatic writebacks, including a downgrade after capability detection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-writeback-legacy-"));
  const database = new Database(join(directory, "database.sqlite"));
  try {
    for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", name), "utf8"));
    const environment = { storage: createSelfHostedStorageAdapter(database, join(directory, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
    const api = (path, init = {}) => fetchEdgeEverApp(new Request(`http://local.test/api/v1${path}`, init), environment, { waitUntil() {}, passThroughOnException() {} });
    const json = async (path, value, method = "POST") => {
      const response = await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      expect(response.ok).toBe(true); return response.json();
    };
    const { notebook } = await json("/notebooks", { name: "Older server" });
    const { memo } = await json("/memos", { notebookId: notebook.id, title: "Legacy", contentMarkdown: "" });
    const form = new FormData(); form.append("file", new File(["original"], "original.xlsx", { type: "application/test" }));
    const response = await api(`/memos/${memo.id}/resources`, { method: "POST", body: form });
    expect(response.status).toBe(201); const { resource } = await response.json();
    await json(`/resources/${resource.id}`, { filename: "renamed-on-other-device.xlsx" }, "PATCH");
    for (const downgrade of [false, true]) {
      const calls = [];
      const transport = async (pathOrId, init) => {
        // The legacy transport ignores the optional field on its old PUT.
        const path = pathOrId.startsWith("/") ? pathOrId : `/resources/${pathOrId}/blob`;
        calls.push([path, init.method]);
        if (path === "/resources/writeback-capabilities") {
          return downgrade ? Response.json({ preserveFilename: true }) : new Response("Old server", { status: 404 });
        }
        if (path.endsWith("/blob/writeback")) return new Response("Old server", { status: 404 });
        if (init.method === "PUT") init.body.delete("preserveFilename");
        return api(path, init);
      };
      await expect(replaceAttachmentResource(transport, {
        resourceId: resource.id, bytes: Buffer.from("local edit"), expectedContentHash: resource.sha256,
        filename: "original.xlsx", mimeType: resource.mimeType, assertCurrent() {},
      })).rejects.toMatchObject({ code: "writeback_unsupported", retryable: false });
      expect(calls.some(([path, method]) => method === "PUT" && path.endsWith("/blob"))).toBe(false);
      if (!downgrade) expect(calls.filter(([, method]) => method === "PUT")).toHaveLength(0);
      expect(database.query("SELECT filename FROM resources WHERE id = ?").get(resource.id).filename).toBe("renamed-on-other-device.xlsx");
      expect(await (await api(`/resources/${resource.id}/blob`)).text()).toBe("original");
    }
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);

test("desktop saves preserve filenames and bounded object keys across renames, retries and failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-writeback-names-"));
  const database = new Database(join(directory, "database.sqlite"));
  try {
    for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", name), "utf8"));
    const storage = createSelfHostedStorageAdapter(database, join(directory, "resources"));
    const environment = { storage, EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
    const api = (path, init = {}) => fetchEdgeEverApp(new Request(`http://local.test/api/v1${path}`, init), environment, { waitUntil() {}, passThroughOnException() {} });
    const json = async (path, value, method = "POST") => {
      const response = await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      expect(response.ok).toBe(true); return response.json();
    };
    const { notebook } = await json("/notebooks", { name: "Filename preservation" });
    const { memo } = await json("/memos", { notebookId: notebook.id, title: "Names", contentMarkdown: "" });
    const form = new FormData(); form.append("file", new File(["original"], "budget.xlsx", { type: "application/test" }));
    const response = await api(`/memos/${memo.id}/resources`, { method: "POST", body: form });
    expect(response.status).toBe(201); let { resource } = await response.json();
    const rename = filename => json(`/resources/${resource.id}`, { filename }, "PATCH");
    const request = (id, init) => api(`/resources/${id}/blob`, init);
    const save = (bytes, baseline = resource.sha256, transport = (path, init) => api(path, init)) => replaceAttachmentResource(transport, {
      resourceId: resource.id, expectedContentHash: baseline, bytes: Buffer.from(bytes),
      filename: "note label (2).xlsx", mimeType: resource.mimeType, assertCurrent() {},
    });
    // Display/local-copy names never rename the authoritative attachment.
    resource = await save("first edit"); expect(resource.filename).toBe("budget.xlsx");
    await rename("renamed.xlsx");
    resource = await save("second edit"); expect(resource.filename).toBe("renamed.xlsx");

    // The rename lands after the service reads the row, before the conditional
    // database update. Reading the latest name before PUT is not sufficient.
    let duringPut = () => rename("renamed-during-upload.xlsx");
    let versionWrites = 0;
    const versionKeys = [];
    const put = storage.resources.put;
    storage.resources.put = async (...args) => {
      await put(...args); versionWrites++; versionKeys.push(args[0]);
      if (duringPut) { const action = duringPut; duringPut = null; await action(); }
    };
    resource = await save("third edit"); expect(resource.filename).toBe("renamed-during-upload.xlsx");
    expect(await (await request(resource.id)).text()).toBe("third edit");

    const baseline = resource.sha256;
    await expect(save("response lost edit", baseline, async (path, init) => {
      const result = await api(path, init);
      if (init.method !== "PUT") return result;
      expect(result.ok).toBe(true); await result.body?.cancel();
      await rename("renamed-after-save.xlsx");
      throw new TypeError("Success response lost");
    })).rejects.toThrow("Success response lost");
    const writesBeforeRetry = versionWrites;
    resource = await save("response lost edit", baseline);
    expect(resource.filename).toBe("renamed-after-save.xlsx");
    expect(versionWrites).toBe(writesBeforeRetry); // Reconciliation is a no-op.
    expect(await (await request(resource.id)).text()).toBe("response lost edit");

    // Existing consumers can still replace the filename, with no new flag or
    // with the optional behavior explicitly disabled.
    for (const preserve of [undefined, "false"]) {
      const replacement = new FormData();
      const filename = preserve === undefined ? "legacy.xlsx" : "explicit-replacement.xlsx";
      replacement.append("file", new File(["ordinary replacement"], filename, { type: resource.mimeType }));
      replacement.append("expectedContentHash", resource.sha256);
      if (preserve !== undefined) replacement.append("preserveFilename", preserve);
      const result = await request(resource.id, { method: "PUT", body: replacement });
      expect(result.ok).toBe(true); ({ resource } = await result.json());
      expect(resource.filename).toBe(filename);
    }

    // Repeated external saves must not append an ever-growing suffix to the
    // previous key. The original self-hosted path fails around the fifth save.
    const currentKey = () => database.query("SELECT object_key FROM resources WHERE id = ?").get(resource.id).object_key;
    const parent = key => key.slice(0, key.lastIndexOf("/") + 1);
    const originalDirectory = parent(currentKey());
    let expectedLength;
    for (let index = 0; index < 12; index++) {
      const previousKey = currentKey();
      resource = await save(`consecutive save ${index}`);
      const key = currentKey();
      expectedLength ??= key.length;
      expect(key.length).toBe(expectedLength);
      expect(parent(key)).toBe(originalDirectory);
      expect(key).not.toBe(previousKey);
      expect(await (await request(resource.id)).text()).toBe(`consecutive save ${index}`);
      await expect(readFile(join(directory, "resources", previousKey))).rejects.toMatchObject({ code: "ENOENT" });
    }

    const keysBeforeConflict = versionKeys.length;
    const oldKey = currentKey();
    duringPut = async () => {
      const winner = new FormData();
      winner.append("file", new File(["other device winner"], "winner.xlsx", { type: resource.mimeType }));
      winner.append("expectedContentHash", resource.sha256);
      const result = await request(resource.id, { method: "PUT", body: winner });
      expect(result.ok).toBe(true);
    };
    await expect(save("losing local edit")).rejects.toMatchObject({ code: "resource_conflict" });
    const candidates = versionKeys.slice(keysBeforeConflict);
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(currentKey());
    for (const key of [oldKey, ...candidates.filter(key => key !== currentKey())]) {
      await expect(readFile(join(directory, "resources", key))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await (await request(resource.id)).text()).toBe("other device winner");

    const acknowledgedKey = currentKey();
    const acknowledgedHash = database.query("SELECT sha256 FROM resources WHERE id = ?").get(resource.id).sha256;
    let interruptedKey;
    storage.resources.put = async (...args) => {
      await put(...args); interruptedKey = args[0];
      throw new Error("Object upload interrupted after writing bytes");
    };
    await expect(save("interrupted local edit", acknowledgedHash)).rejects.toMatchObject({ retryable: true });
    expect(currentKey()).toBe(acknowledgedKey);
    expect(await (await request(resource.id)).text()).toBe("other device winner");
    await expect(readFile(join(directory, "resources", interruptedKey))).rejects.toMatchObject({ code: "ENOENT" });

    // A database write can commit before its response fails. Neither that
    // response error nor an unavailable confirmation read may delete live bytes.
    storage.resources.put = put;
    const prepare = storage.db.prepare.bind(storage.db);
    let loseCommitResponse = true, failConfirmation = false;
    storage.db.prepare = sql => {
      const wrap = statement => ({
        bind: (...values) => wrap(statement.bind(...values)),
        all: (...args) => statement.all(...args),
        first: (...args) => {
          if (failConfirmation && sql.includes("FROM resources")) { failConfirmation = false; throw new Error("Confirmation read unavailable"); }
          return statement.first(...args);
        },
        run: async (...args) => {
          const result = await statement.run(...args);
          if (loseCommitResponse && sql.startsWith("UPDATE resources") && sql.includes("SET object_key")) {
            loseCommitResponse = false; failConfirmation = true;
            throw new Error("Committed pointer response lost");
          }
          return result;
        },
      });
      return wrap(prepare(sql));
    };
    await expect(save("committed but uncertain", acknowledgedHash)).rejects.toMatchObject({ retryable: true });
    failConfirmation = false;
    expect(currentKey()).not.toBe(acknowledgedKey);
    const recovered = await request(resource.id);
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toBe("committed but uncertain");
    resource = await save("committed but uncertain", acknowledgedHash);
    expect(resource.filename).toBe("winner.xlsx");
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);
