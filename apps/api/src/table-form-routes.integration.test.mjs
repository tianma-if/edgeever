import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { applyTableView, getTableViews, saveTableViews, parseTableDocument, serializeTableDocument } from "@edgeever/shared";
import { AppError } from "./app-error.ts";
import { apiError } from "./http-errors.ts";
import { createMemoEditSession, createMemoRecord, getMemoDetail, updateMemoRecord } from "./memo-service.ts";
import { createAttachmentResource } from "./resource-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerPublicTableFormRoutes, registerTableFormRoutes } from "./table-form-routes.ts";

// Public forms are reached without a session: anyone with the link can read
// the form fields, unlock it with the password and append one row to the
// table. The owner configures the form through the signed-in API.
const WORKSPACE_ID = "ws_default";
const OTHER_WORKSPACE_ID = "ws_other";
const ownerAuth = {
  kind: "user", actorType: "user", actorId: "usr_owner", username: "admin", displayName: "Admin",
  scopes: [], workspaceId: WORKSPACE_ID, role: "owner",
};
const otherAuth = { ...ownerAuth, actorId: "usr_other", username: "other", workspaceId: OTHER_WORKSPACE_ID };
const agentAuth = { ...ownerAuth, kind: "agent", actorType: "agent", actorId: "tok_agent", scopes: ["read:memos", "write:memos"] };
const actor = { actorType: "user", actorId: "usr_owner" };
const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

const FIELDS = [
  { id: "fld_name", name: "Name", type: "text" },
  { id: "fld_qty", name: "Quantity", type: "number" },
  { id: "fld_ok", name: "Agree", type: "checkbox" },
  { id: "fld_day", name: "Day", type: "date" },
  { id: "fld_kind", name: "Kind", type: "select", options: ["Alpha", "Beta"] },
  { id: "fld_link", name: "Link", type: "url" },
  { id: "fld_files", name: "Files", type: "attachment" },
  { id: "fld_private", name: "Internal notes", type: "text" },
];
const EXISTING_RECORD = {
  id: "rec_existing",
  cells: {
    fld_name: "Existing private row", fld_qty: 7, fld_ok: true, fld_day: "2026-01-01", fld_kind: "Alpha",
    fld_link: "https://example.com/private", fld_files: [], fld_private: "salary 9000",
  },
};
const tableMarkdown = (records = [EXISTING_RECORD], fields = FIELDS) => serializeTableDocument({
  schemaVersion: 1, fields, records, view: { filters: [], sort: null },
});
const FORM_FIELDS = [
  { fieldId: "fld_name", required: true },
  { fieldId: "fld_qty", required: false },
  { fieldId: "fld_ok", required: false },
  { fieldId: "fld_day", required: false },
  { fieldId: "fld_kind", required: false },
  { fieldId: "fld_link", required: false },
  { fieldId: "fld_files", required: false },
];
const formSettings = (overrides = {}) => ({
  enabled: true, passwordProtected: false, title: "Sign-up", description: "Tell us about you",
  submitLabel: "Send", fields: FORM_FIELDS, ...overrides,
});

const installation = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) sqlite.exec(readFileSync(file, "utf8"));
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, 'Other', 1)").run(OTHER_WORKSPACE_ID);
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, slug) VALUES ('nb_other', ?, 'Other', 'other')").run(OTHER_WORKSPACE_ID);
  const resourcesDirectory = mkdtempSync(join(tmpdir(), "edgeever-table-form-"));
  cleanups.push(() => {
    sqlite.close();
    rmSync(resourcesDirectory, { recursive: true, force: true });
  });
  const storage = createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
  const app = new Hono();
  let auth = ownerAuth;
  // Mirrors index.ts: public form routes are registered before the /api/v1
  // auth middleware and never see an auth context.
  registerPublicTableFormRoutes(app);
  app.use("/api/v1/*", async (context, next) => {
    if (!auth) return apiError(context, "unauthorized", "Authentication required.", 401);
    context.set("auth", auth);
    await next();
  });
  // Mirrors the application's error handler in index.ts.
  app.onError((error, context) => {
    if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
    throw error;
  });
  registerTableFormRoutes(app);
  const request = async (path, init = {}) => {
    const response = await app.request(path, init, { storage });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
  };
  const sendJson = (method, path, body, headers = {}) => request(path, {
    method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const storedFiles = () => readdirSync(resourcesDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
  const context = (workspaceId = WORKSPACE_ID) => ({
    env: { storage },
    get: (key) => (key === "auth" ? { ...ownerAuth, workspaceId } : undefined),
  });
  const inbox = sqlite.query("SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox'").get(WORKSPACE_ID).id;
  const createTable = async ({ workspaceId = WORKSPACE_ID, notebookId = inbox, title = "Private table title", markdown = tableMarkdown() } = {}) => {
    const created = await createMemoRecord(storage.db, workspaceId, { notebookId, title, contentMarkdown: markdown }, actor, "owner");
    return created.id ?? created.memo?.id;
  };
  const configure = async (memoId, settings = formSettings()) => {
    const response = await sendJson("PUT", `/api/v1/memos/${memoId}/form`, settings);
    expect(response.status).toBe(200);
    return response.body.form;
  };
  const upload = (token, file, headers = {}) => {
    const form = new FormData();
    if (file) form.set("file", file);
    return request(`/api/public/forms/${token}/resources`, { method: "POST", body: form, headers });
  };
  const submit = (token, cells, headers = {}) => sendJson("POST", `/api/public/forms/${token}/submissions`, { cells }, headers);
  const document = async (memoId, workspaceId = WORKSPACE_ID) =>
    parseTableDocument((await getMemoDetail(storage.db, workspaceId, memoId)).contentMarkdown);
  // A file uploaded through the form, stored the way the upload route stores it.
  const pendingUpload = async (memoId, formId, { filename = "cv.pdf", pending = 1, createdAt, workspaceId } = {}) => {
    const resource = await createAttachmentResource(context(workspaceId), {
      memoId, filename, mimeType: "application/pdf", bytes: new TextEncoder().encode(`%PDF ${filename}`),
      actor, metadata: { tableFormId: formId, pending },
    });
    if (createdAt) sqlite.query("UPDATE resources SET created_at = ? WHERE id = ?").run(createdAt, resource.id);
    return resource.id;
  };
  const formRow = (memoId) => sqlite.query("SELECT * FROM table_forms WHERE memo_id = ?").get(memoId);
  return {
    sqlite, storage, request, sendJson, storedFiles, createTable, configure, upload, submit, document,
    pendingUpload, formRow, setAuth: (next) => { auth = next; },
  };
};

const cookieFrom = (response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";
const NOT_FOUND = { error: { code: "not_found", message: "Form not found" } };

describe("table form owner routes", () => {
  test("only a signed-in user of the note's workspace can read or change its form", async () => {
    const env = installation();
    const memoId = await env.createTable();

    expect((await env.request(`/api/v1/memos/${memoId}/form`)).body).toEqual({ form: null });
    const saved = await env.configure(memoId, formSettings({
      fields: [
        { fieldId: "fld_name", required: true },
        { fieldId: "fld_name", required: false },
        { fieldId: "fld_missing", required: true },
        { fieldId: "fld_kind", required: false },
      ],
    }));
    expect(saved.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.fields).toEqual([{ fieldId: "fld_name", required: true }, { fieldId: "fld_kind", required: false }]);
    expect(saved.passwordProtected).toBe(false);
    expect(saved).not.toHaveProperty("password");
    expect((await env.request(`/api/v1/memos/${memoId}/form`)).body.form).toEqual(saved);

    env.setAuth(otherAuth);
    expect((await env.request(`/api/v1/memos/${memoId}/form`)).body).toEqual({ form: null });
    const foreign = await env.sendJson("PUT", `/api/v1/memos/${memoId}/form`, formSettings({ title: "Hijacked" }));
    expect(foreign.status).toBe(404);
    expect(env.formRow(memoId).title).toBe("Sign-up");
    expect(env.sqlite.query("SELECT COUNT(*) AS count FROM table_forms").get().count).toBe(1);

    env.setAuth(agentAuth);
    expect((await env.request(`/api/v1/memos/${memoId}/form`)).status).toBe(403);
    expect((await env.sendJson("PUT", `/api/v1/memos/${memoId}/form`, formSettings())).status).toBe(403);

    env.setAuth(null);
    expect((await env.request(`/api/v1/memos/${memoId}/form`)).status).toBe(401);
  });

  test("rejects notes that are not tables and forms without any table field", async () => {
    const env = installation();
    const plain = await env.createTable({ markdown: "Just a note" });
    expect((await env.sendJson("PUT", `/api/v1/memos/${plain}/form`, formSettings())).status).toBe(404);
    expect((await env.sendJson("PUT", "/api/v1/memos/memo_missing/form", formSettings())).status).toBe(404);

    const table = await env.createTable();
    const empty = await env.sendJson("PUT", `/api/v1/memos/${table}/form`, formSettings({ fields: [{ fieldId: "fld_missing", required: true }] }));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("table_form_invalid");
    // A closed form may be saved without fields.
    const closed = await env.configure(table, formSettings({ enabled: false, fields: [] }));
    expect(closed.enabled).toBe(false);
    expect(env.sqlite.query("SELECT action FROM audit_events WHERE entity_id = ? AND action = 'table_form.update'").all(table)).toHaveLength(1);
  });

  test("shows a generated password once, keeps it across saves and rotates it on request", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const protectedForm = await env.configure(memoId, formSettings({ passwordProtected: true }));
    expect(protectedForm.passwordProtected).toBe(true);
    expect(protectedForm.password).toEqual(expect.any(String));
    const firstHash = env.formRow(memoId).password_hash;
    expect(firstHash).not.toContain(protectedForm.password);
    expect((await env.request(`/api/v1/memos/${memoId}/form`)).body.form).not.toHaveProperty("password");

    const kept = await env.configure(memoId, formSettings({ passwordProtected: true, title: "Renamed" }));
    expect(kept).not.toHaveProperty("password");
    expect(kept.token).toBe(protectedForm.token);
    expect(env.formRow(memoId).password_hash).toBe(firstHash);

    const rotated = await env.configure(memoId, formSettings({ passwordProtected: true, rotatePassword: true }));
    expect(rotated.password).not.toBe(protectedForm.password);
    expect(env.formRow(memoId).password_hash).not.toBe(firstHash);

    const open = await env.configure(memoId, formSettings({ passwordProtected: false }));
    expect(open.passwordProtected).toBe(false);
    expect(env.formRow(memoId).password_hash).toBeNull();
  });
});

describe("public table form access", () => {
  test("unknown, closed and deleted-note forms all answer with the same not found", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    expect((await env.request(`/api/public/forms/${token}`)).status).toBe(200);

    const responses = [];
    responses.push(await env.request("/api/public/forms/short"));
    responses.push(await env.request(`/api/public/forms/${"A".repeat(43)}`));
    responses.push(await env.request(`/api/public/forms/${token.slice(0, 42)}!`));
    await env.configure(memoId, formSettings({ enabled: false }));
    responses.push(await env.request(`/api/public/forms/${token}`));
    await env.configure(memoId, formSettings());
    env.sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(memoId);
    responses.push(await env.request(`/api/public/forms/${token}`));
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
    }
    for (const path of ["unlock", "submissions"]) {
      const response = await env.sendJson("POST", `/api/public/forms/${token}/${path}`, path === "unlock" ? { password: "x" } : { cells: { fld_name: "x" } });
      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND);
    }
    expect((await env.upload(token, new File(["x"], "a.txt"))).body).toEqual(NOT_FOUND);
    const stored = env.sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(memoId).content_markdown;
    expect(parseTableDocument(stored).records).toHaveLength(1);
    expect(env.sqlite.query("SELECT COUNT(*) AS count FROM resources").get().count).toBe(0);
  });

  test("publishes only the configured fields, never the table's records or other columns", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const response = await env.request(`/api/public/forms/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.body).toEqual({
      form: {
        passwordRequired: false,
        title: "Sign-up",
        description: "Tell us about you",
        submitLabel: "Send",
        full: false,
        fields: [
          { id: "fld_name", name: "Name", type: "text", required: true },
          { id: "fld_qty", name: "Quantity", type: "number", required: false },
          { id: "fld_ok", name: "Agree", type: "checkbox", required: false },
          { id: "fld_day", name: "Day", type: "date", required: false },
          { id: "fld_kind", name: "Kind", type: "select", required: false, options: ["Alpha", "Beta"] },
          { id: "fld_link", name: "Link", type: "url", required: false },
          { id: "fld_files", name: "Files", type: "attachment", required: false },
        ],
      },
    });
    for (const secret of ["Internal notes", "fld_private", "Existing private row", "salary", "rec_existing", "Private table title", memoId, WORKSPACE_ID]) {
      expect(response.text).not.toContain(secret);
    }

    // A field removed from the table after the form was saved disappears from the form.
    env.sqlite.query("UPDATE memo_contents SET content_markdown = ? WHERE memo_id = ?")
      .run(tableMarkdown([EXISTING_RECORD], FIELDS.filter((field) => field.id !== "fld_kind")), memoId);
    const pruned = await env.request(`/api/public/forms/${token}`);
    expect(pruned.body.form.fields.map((field) => field.id)).not.toContain("fld_kind");
  });

  test("falls back to the note title only when the form has none", async () => {
    const env = installation();
    const memoId = await env.createTable({ title: "Volunteers" });
    const { token } = await env.configure(memoId, formSettings({ title: "" }));
    expect((await env.request(`/api/public/forms/${token}`)).body.form.title).toBe("Volunteers");
  });

  test("a password-protected form reveals nothing and accepts nothing until unlocked", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token, password } = await env.configure(memoId, formSettings({ passwordProtected: true }));

    const locked = await env.request(`/api/public/forms/${token}`);
    expect(locked.status).toBe(200);
    expect(locked.body.form).toEqual({ passwordRequired: true, title: "", description: "", submitLabel: "", full: false, fields: [] });
    expect((await env.submit(token, { fld_name: "Mallory" })).body).toEqual(NOT_FOUND);
    expect((await env.upload(token, new File(["x"], "a.txt"))).body).toEqual(NOT_FOUND);
    expect((await env.submit(token, { fld_name: "Mallory" }, { Cookie: "ee_form=forged.value" })).status).toBe(404);

    const wrong = await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password: "not-the-password" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe("table_form_password_invalid");
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(env.formRow(memoId).unlock_failed_count).toBe(1);

    const unlocked = await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password });
    expect(unlocked.status).toBe(200);
    const setCookie = unlocked.headers.get("set-cookie");
    expect(setCookie).toContain(`Path=/api/public/forms/${token}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(env.formRow(memoId).unlock_failed_count).toBe(0);
    const cookie = { Cookie: cookieFrom(unlocked) };

    const open = await env.request(`/api/public/forms/${token}`, { headers: cookie });
    expect(open.body.form.passwordRequired).toBe(false);
    expect(open.body.form.fields).toHaveLength(FORM_FIELDS.length);
    expect((await env.submit(token, { fld_name: "Alice" }, cookie)).status).toBe(201);

    // Rotating the password signs out everyone who unlocked with the old one.
    await env.configure(memoId, formSettings({ passwordProtected: true, rotatePassword: true }));
    expect((await env.request(`/api/public/forms/${token}`, { headers: cookie })).body.form.passwordRequired).toBe(true);
    expect((await env.submit(token, { fld_name: "Late" }, cookie)).status).toBe(404);
    expect((await env.document(memoId)).records.map((record) => record.cells.fld_name)).toEqual(["Existing private row", "Alice"]);
  });

  test("unlocking one form does not open another form", async () => {
    const env = installation();
    const first = await env.configure(await env.createTable(), formSettings({ passwordProtected: true }));
    const secondMemo = await env.createTable();
    const second = await env.configure(secondMemo, formSettings({ passwordProtected: true }));
    const unlocked = await env.sendJson("POST", `/api/public/forms/${first.token}/unlock`, { password: first.password });
    const cookie = { Cookie: cookieFrom(unlocked) };

    expect((await env.request(`/api/public/forms/${second.token}`, { headers: cookie })).body.form.passwordRequired).toBe(true);
    expect((await env.submit(second.token, { fld_name: "Mallory" }, cookie)).status).toBe(404);
    expect((await env.sendJson("POST", `/api/public/forms/${second.token}/unlock`, { password: first.password })).status).toBe(403);
    expect((await env.document(secondMemo)).records).toHaveLength(1);
  });

  test("blocks password guessing after repeated failures, even for the right password", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token, password } = await env.configure(memoId, formSettings({ passwordProtected: true }));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password: `guess-${attempt}` })).status).toBe(403);
    }
    expect(Date.parse(env.formRow(memoId).unlock_blocked_until)).toBeGreaterThan(Date.now());
    const blocked = await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("table_form_rate_limited");
    expect(blocked.headers.get("set-cookie")).toBeNull();

    env.sqlite.query("UPDATE table_forms SET unlock_blocked_until = ? WHERE memo_id = ?").run(new Date(Date.now() - 1000).toISOString(), memoId);
    expect((await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password })).status).toBe(200);
  });

  test("an open form has no password to unlock", async () => {
    const env = installation();
    const { token } = await env.configure(await env.createTable());
    const response = await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password: "anything" });
    expect(response.status).toBe(404);
    expect((await env.sendJson("POST", `/api/public/forms/${token}/unlock`, { password: "" })).status).toBe(400);
  });
});

// Submission tests create their pending uploads through createAttachmentResource
// with the metadata the upload route writes ({ tableFormId, pending: 1 }).
describe("public table form uploads", () => {
  test("rejects missing, empty and oversized files before storing anything", async () => {
    const env = installation();
    const { token } = await env.configure(await env.createTable());
    const missing = await env.upload(token, null);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("table_form_invalid");
    const empty = await env.upload(token, new File([], "empty.txt"));
    expect(empty.status).toBe(413);
    expect(empty.body.error.code).toBe("upload_too_large");
    const huge = await env.upload(token, new File([new Uint8Array(20 * 1024 * 1024 + 1)], "huge.bin"));
    expect(huge.status).toBe(413);
    expect(env.sqlite.query("SELECT COUNT(*) AS count FROM resources").get().count).toBe(0);
    expect(env.storedFiles()).toEqual([]);
  });

  test("stores a visitor's files in the note's workspace and lets the new row use them", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const formId = env.formRow(memoId).id;
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

    const text = await env.upload(token, new File(["hello"], "notes.txt", { type: "text/plain" }));
    const image = await env.upload(token, new File([png], "photo.png", { type: "image/png" }));

    expect(text.status).toBe(201);
    expect(text.body.resource).toMatchObject({ filename: "notes.txt", byteSize: 5 });
    expect(text.body.resource.mimeType).toStartWith("text/plain");
    expect(image.status).toBe(201);
    expect(image.body.resource).toMatchObject({ filename: "photo.png", mimeType: "image/png", byteSize: png.byteLength });
    for (const { body } of [text, image]) {
      const row = env.sqlite.query("SELECT memo_id, object_key, metadata_json FROM resources WHERE id = ?").get(body.resource.id);
      expect(row.memo_id).toBe(memoId);
      expect(row.object_key.startsWith(`workspaces/${WORKSPACE_ID}/memos/${memoId}/`)).toBe(true);
      expect(JSON.parse(row.metadata_json)).toMatchObject({ tableFormId: formId, pending: 1 });
    }
    expect(env.storedFiles()).toHaveLength(2);

    const submitted = await env.submit(token, { fld_name: "Ann", fld_files: [text.body.resource.id, image.body.resource.id] });
    expect(submitted.status).toBe(201);
    expect((await env.document(memoId)).records.at(-1).cells.fld_files.map((file) => file.resourceId))
      .toEqual([text.body.resource.id, image.body.resource.id]);
    const pending = (id) => JSON.parse(env.sqlite.query("SELECT metadata_json FROM resources WHERE id = ?").get(id).metadata_json).pending;
    expect(pending(text.body.resource.id)).toBe(0);
    expect(pending(image.body.resource.id)).toBe(0);
  });

  test("refuses files for a form without an attachment field", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId, formSettings({ fields: FORM_FIELDS.filter((field) => field.fieldId !== "fld_files") }));

    const response = await env.upload(token, new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("table_form_invalid");
    expect(env.sqlite.query("SELECT COUNT(*) AS count FROM resources").get().count).toBe(0);
    expect(env.storedFiles()).toEqual([]);
  });

  test("limits the uploads a form holds before they are submitted", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const formId = env.formRow(memoId).id;
    for (let index = 0; index < 50; index += 1) await env.pendingUpload(memoId, formId, { filename: `waiting-${index}.pdf` });
    const filesBefore = env.storedFiles().length;

    const response = await env.upload(token, new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("table_form_rate_limited");
    expect(env.storedFiles()).toHaveLength(filesBefore);
  });

  test("keeps the upload limit when uploads arrive at the same time", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const formId = env.formRow(memoId).id;
    for (let index = 0; index < 45; index += 1) await env.pendingUpload(memoId, formId, { filename: `waiting-${index}.pdf` });

    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => (
      env.upload(token, new File([`file ${index}`], `burst-${index}.txt`, { type: "text/plain" }))
    )));

    expect(responses.every((response) => response.status === 201 || response.status === 429)).toBe(true);
    const pending = env.sqlite.query(
      `SELECT COUNT(*) AS count FROM resources
       WHERE is_deleted = 0 AND json_extract(metadata_json, '$.pending') = 1`,
    ).get().count;
    expect(pending).toBeLessThanOrEqual(50);
    expect(env.storedFiles()).toHaveLength(pending);
  });

  test("keeps a file pending when the submission sends it outside an attachment field", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const uploaded = await env.upload(token, new File(["hello"], "notes.txt", { type: "text/plain" }));
    const id = uploaded.body.resource.id;

    expect((await env.submit(token, { fld_name: "Ann", fld_private: [id], fld_files: [] })).status).toBe(201);

    expect(JSON.parse(env.sqlite.query("SELECT metadata_json FROM resources WHERE id = ?").get(id).metadata_json).pending).toBe(1);
    expect((await env.document(memoId)).records.at(-1).cells.fld_files).toEqual([]);
  });

  test("retires pending uploads older than an hour and their stored files", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const formId = env.formRow(memoId).id;
    const otherForm = await env.configure(await env.createTable());
    const otherFormMemo = env.sqlite.query("SELECT memo_id FROM table_forms WHERE token = ?").get(otherForm.token).memo_id;
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const stale = await env.pendingUpload(memoId, formId, { filename: "stale.pdf", createdAt: old });
    const fresh = await env.pendingUpload(memoId, formId, { filename: "fresh.pdf" });
    const submitted = await env.pendingUpload(memoId, formId, { filename: "kept.pdf", pending: 0, createdAt: old });
    const elsewhere = await env.pendingUpload(otherFormMemo, env.formRow(otherFormMemo).id, { filename: "other.pdf", createdAt: old });
    expect(env.storedFiles()).toHaveLength(4);

    // Any upload attempt, even a rejected one, sweeps the form's stale uploads.
    expect((await env.upload(token, null)).status).toBe(400);
    const state = Object.fromEntries(env.sqlite.query("SELECT id, is_deleted FROM resources").all().map((row) => [row.id, row.is_deleted]));
    expect(state).toEqual({ [stale]: 1, [fresh]: 0, [submitted]: 0, [elsewhere]: 0 });
    expect(env.storedFiles()).toHaveLength(3);
    expect(env.storedFiles().some((file) => file.includes(stale))).toBe(false);
  });
});

describe("public table form submissions", () => {
  test("appends exactly one row with coerced values and leaves existing rows untouched", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const otherMemo = await env.createTable({ title: "Untouched" });
    const otherBefore = env.sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(otherMemo).content_markdown;
    const { token } = await env.configure(memoId);
    const before = await getMemoDetail(env.storage.db, WORKSPACE_ID, memoId);

    const response = await env.submit(token, {
      fld_name: `  Alice ${"x".repeat(2100)}`,
      fld_qty: "42",
      fld_ok: "true",
      fld_day: "2026-10-14",
      fld_kind: " Beta ",
      fld_link: "https://example.com/alice",
      fld_private: "injected into a hidden column",
      rec_existing: "overwrite attempt",
      id: "rec_existing",
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const after = await getMemoDetail(env.storage.db, WORKSPACE_ID, memoId);
    const table = parseTableDocument(after.contentMarkdown);
    expect(table.records).toHaveLength(2);
    expect(table.records[0]).toEqual(EXISTING_RECORD);
    const [, added] = table.records;
    expect(added.id).not.toBe("rec_existing");
    expect(added.cells).toEqual({
      fld_name: `  Alice ${"x".repeat(2100)}`.slice(0, 2000),
      fld_qty: 42,
      fld_ok: true,
      fld_day: "2026-10-14",
      fld_kind: "Beta",
      fld_link: "https://example.com/alice",
      fld_files: [],
      fld_private: "",
    });
    expect(after.revision).toBe(before.revision + 1);
    expect(after.title).toBe(before.title);
    expect(env.sqlite.query("SELECT updated_by FROM memos WHERE id = ?").get(memoId).updated_by).toBe("table-form");
    expect(env.sqlite.query("SELECT content_text FROM memo_search_documents WHERE memo_id = ?").get(memoId).content_text).toContain("Alice");
    expect(env.sqlite.query("SELECT content_markdown FROM memo_contents WHERE memo_id = ?").get(otherMemo).content_markdown).toBe(otherBefore);
    expect(env.formRow(memoId).submit_count).toBe(1);
  });

  test("rejects values that do not fit the field type and missing required fields", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId, formSettings({
      fields: [
        ...FORM_FIELDS.filter((field) => field.fieldId !== "fld_ok" && field.fieldId !== "fld_files"),
        { fieldId: "fld_ok", required: true },
        { fieldId: "fld_files", required: true },
      ],
    }));
    const pdf = await env.pendingUpload(memoId, env.formRow(memoId).id);
    const valid = { fld_name: "Bob", fld_ok: true, fld_files: [pdf] };
    const cases = [
      [{ ...valid, fld_kind: "Gamma" }, "table_form_invalid"],
      [{ ...valid, fld_link: "javascript:alert(1)" }, "table_form_invalid"],
      [{ ...valid, fld_day: "14/10/2026" }, "table_form_invalid"],
      [{ ...valid, fld_qty: "lots" }, "table_form_invalid"],
      [{ ...valid, fld_name: "" }, "table_form_required"],
      [{ ...valid, fld_name: undefined }, "table_form_required"],
      [{ ...valid, fld_ok: false }, "table_form_required"],
      [{ ...valid, fld_files: [] }, "table_form_required"],
      [{ ...valid, fld_files: ["res_unknown"] }, "table_form_required"],
    ];
    for (const [cells, code] of cases) {
      const response = await env.submit(token, cells);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(code);
    }
    expect((await env.sendJson("POST", `/api/public/forms/${token}/submissions`, { rows: [] })).status).toBe(400);
    expect((await env.document(memoId)).records).toHaveLength(1);

    expect((await env.submit(token, valid)).status).toBe(201);
    const added = (await env.document(memoId)).records[1];
    expect(added.cells.fld_files).toEqual([{ resourceId: pdf, filename: "cv.pdf", mimeType: "application/pdf", byteSize: "%PDF cv.pdf".length }]);
  });

  test("attaches only pending uploads made through the same form", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    const formId = env.formRow(memoId).id;
    const otherMemo = await env.createTable();
    await env.configure(otherMemo);
    const foreignMemo = await env.createTable({ workspaceId: OTHER_WORKSPACE_ID, notebookId: "nb_other" });
    env.setAuth(otherAuth);
    await env.configure(foreignMemo);
    env.setAuth(ownerAuth);

    const own = await env.pendingUpload(memoId, formId, { filename: "own.pdf" });
    const otherForm = await env.pendingUpload(otherMemo, env.formRow(otherMemo).id, { filename: "other-form.pdf" });
    const foreign = await env.pendingUpload(foreignMemo, env.formRow(foreignMemo).id, { filename: "foreign.pdf", workspaceId: OTHER_WORKSPACE_ID });
    const noteFile = (await createAttachmentResource({ env: { storage: env.storage }, get: () => ownerAuth }, {
      memoId, filename: "owner.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]), actor,
    })).id;
    const reused = await env.pendingUpload(memoId, formId, { filename: "reused.pdf", pending: 0 });
    const spoofed = await env.pendingUpload(memoId, "form_other", { filename: "spoofed.pdf" });

    for (const resourceId of [otherForm, foreign, noteFile, reused, spoofed]) {
      expect((await env.submit(token, { fld_name: "Eve", fld_files: [resourceId] })).status).toBe(201);
    }
    const objects = (await env.document(memoId)).records.slice(1).map((record) => record.cells.fld_files);
    expect(objects).toEqual([[], [], [], [], []]);

    // Duplicates collapse; client-supplied metadata is replaced by the stored resource's.
    const response = await env.submit(token, {
      fld_name: "Ann",
      fld_files: [{ resourceId: own, filename: "evil.exe", mimeType: "text/html", byteSize: 1 }, own, otherForm],
    });
    expect(response.status).toBe(201);
    const added = (await env.document(memoId)).records.at(-1);
    expect(added.cells.fld_files).toEqual([{ resourceId: own, filename: "own.pdf", mimeType: "application/pdf", byteSize: "%PDF own.pdf".length }]);
    const pending = (id) => JSON.parse(env.sqlite.query("SELECT metadata_json FROM resources WHERE id = ?").get(id).metadata_json).pending;
    expect(pending(own)).toBe(0);
    expect(pending(otherForm)).toBe(1);
    expect(pending(foreign)).toBe(1);

    // A used upload cannot be attached to a second response.
    expect((await env.submit(token, { fld_name: "Ann again", fld_files: [own] })).status).toBe(201);
    expect((await env.document(memoId)).records.at(-1).cells.fld_files).toEqual([]);
  });

  test("throttles submissions per form and stops when the table is full", async () => {
    const env = installation();
    const memoId = await env.createTable();
    const { token } = await env.configure(memoId);
    env.sqlite.query("UPDATE table_forms SET submit_count = 30, submit_window_started_at = ? WHERE memo_id = ?")
      .run(new Date(Date.now() - 60 * 1000).toISOString(), memoId);
    const limited = await env.submit(token, { fld_name: "Flood" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("table_form_rate_limited");
    expect((await env.document(memoId)).records).toHaveLength(1);

    env.sqlite.query("UPDATE table_forms SET submit_window_started_at = ? WHERE memo_id = ?")
      .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), memoId);
    expect((await env.submit(token, { fld_name: "Later" })).status).toBe(201);
    expect(env.formRow(memoId).submit_count).toBe(1);

    const full = await env.createTable({
      markdown: tableMarkdown(Array.from({ length: 2000 }, (_, index) => ({ id: `rec_${index}`, cells: { fld_name: `Row ${index}` } }))),
    });
    const fullForm = await env.configure(full);
    expect((await env.request(`/api/public/forms/${fullForm.token}`)).body.form.full).toBe(true);
    const rejected = await env.submit(fullForm.token, { fld_name: "One more" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("table_record_limit");
    expect((await env.document(full)).records).toHaveLength(2000);
  });
});


test("an existing public form appends to a v2 table without changing its views; replayed v1 content is rejected", async () => {
  const env = installation();
  const db = env.storage.db;
  const memoId = await env.createTable();
  const { token } = await env.configure(memoId);
  const original = await getMemoDetail(db, WORKSPACE_ID, memoId);
  const legacy = parseTableDocument(original.contentMarkdown);
  const views = [...getTableViews(legacy), { id: "quantity", name: "At least five", match: "all",
    filters: [{ fieldId: "fld_qty", operator: "gte", value: 5 }],
    sorts: [{ fieldId: "fld_qty", direction: "desc" }, { fieldId: "fld_name", direction: "asc" }],
  }];
  const v2 = saveTableViews(legacy, views);
  const saved = await updateMemoRecord(db, WORKSPACE_ID, memoId, {
    expectedRevision: original.revision, contentMarkdown: serializeTableDocument(v2),
  }, actor, "owner");
  expect(saved.memo).toBeDefined();

  expect((await env.request(`/api/public/forms/${token}`)).status).toBe(200);
  expect((await env.submit(token, { fld_name: "Matching", fld_qty: 9 })).status).toBe(201);
  expect((await env.submit(token, { fld_name: "Not matching", fld_qty: 2 })).status).toBe(201);
  const after = await env.document(memoId);
  expect(after.views).toEqual(v2.views);
  expect(after.records).toHaveLength(3);
  expect(applyTableView(after, after.records, after.views[1]).map((row) => row.cells.fld_name))
    .toEqual(["Matching", "Existing private row"]);

  // Even a replay bound to the latest revision and valid edit session cannot downgrade the document.
  const current = await getMemoDetail(db, WORKSPACE_ID, memoId);
  const editSession = await createMemoEditSession({ env: { storage: env.storage }, get: () => ownerAuth }, memoId);
  const replay = await updateMemoRecord(db, WORKSPACE_ID, memoId, {
    expectedRevision: current.revision, expectedContentHash: current.contentHash, editSessionId: editSession.id,
    contentMarkdown: original.contentMarkdown,
  }, actor, "owner", true);
  expect(replay).toMatchObject({ error: "content_conflict", status: 409 });
  expect(await env.document(memoId)).toEqual(after);
});
