// Off-site backup copies against real WebDAV servers.
// Start them with: docker compose -f tests/webdav/compose.yml up -d
// Then run:        bun run test:webdav
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "webdav";
import { OffsiteBackup } from "../apps/desktop/src/main/backup-offsite.mjs";

const URL = process.env.EDGEEVER_WEBDAV_URL ?? "http://127.0.0.1:18080";
const LIMITED_URL = process.env.EDGEEVER_WEBDAV_LIMITED_URL ?? "http://127.0.0.1:18081";
const USER = process.env.EDGEEVER_WEBDAV_USER ?? "tester";
const PASSWORD = process.env.EDGEEVER_WEBDAV_PASSWORD ?? "test-pass-123";
const SET = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const secureStorage = {
  isEncryptionAvailable: () => true, isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s) => Buffer.from(`sealed:${s}`), decryptStringAsync: async (b) => ({ result: b.toString().slice(7), shouldReEncrypt: false }),
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const root = await mkdtemp(join(tmpdir(), "edgeever-webdav-it-"));
const backups = join(root, "backups");
await mkdir(join(root, "private", "scheduled-backups"), { recursive: true });
await mkdir(join(backups, SET), { recursive: true });
const folder = `/it-${Date.now()}`;
const remote = createClient(URL, { username: USER, password: PASSWORD });
const results = [];
const step = async (name, run) => {
  try { await run(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
  console.log(results.at(-1));
};
const archive = async (name, size) => {
  const bytes = randomBytes(size);
  await writeFile(join(backups, SET, name), bytes);
  return { entry: { name, directory: backups, size, completedAt: new Date().toISOString() }, bytes };
};
const offsite = new OffsiteBackup({ userData: join(root, "private"), secureStorage });
const settle = async () => { while (offsite.upload || offsite.queued) await new Promise((r) => setTimeout(r, 20)); };
await offsite.setScope("it-scope", SET);

try {
  await step("test connection: right password passes, wrong password is reported", async () => {
    assert.deepEqual(await offsite.test({ url: URL, username: USER, folder }, PASSWORD), { ok: true });
    await assert.rejects(offsite.test({ url: URL, username: USER, folder }, "wrong"), { code: "offsite_auth_failed" });
  });

  await offsite.save({ enabled: true, url: URL, username: USER, folder }, PASSWORD);

  await step("plain and encrypted archives upload byte-for-byte without leftover .part files", async () => {
    for (const [name, size] of [["edgeever-backup-1.zip", 3 * 1024 * 1024], ["edgeever-backup-2.edgeever.enc", 512 * 1024]]) {
      const { entry, bytes } = await archive(name, size);
      offsite.enqueue(entry, 5); await settle();
      assert.equal(offsite.status().error, null, JSON.stringify(offsite.status().error));
      const downloaded = await remote.getFileContents(`${folder}/${SET}/${name}`);
      assert.equal(sha(Buffer.from(downloaded)), sha(bytes));
    }
    const listing = await remote.getDirectoryContents(`${folder}/${SET}`);
    assert.deepEqual(listing.filter((item) => item.basename.endsWith(".part")), []);
  });

  await step("remote retention keeps the newest copies and never deletes foreign files", async () => {
    await remote.putFileContents(`${folder}/${SET}/manual.zip`, "keep");
    for (const name of ["r1.zip", "r2.zip", "r3.zip"]) {
      const { entry } = await archive(name, 1024);
      offsite.enqueue(entry, 2); await settle();
      await new Promise((r) => setTimeout(r, 10));
    }
    const names = (await remote.getDirectoryContents(`${folder}/${SET}`)).map((item) => item.basename).sort();
    assert.deepEqual(names, ["manual.zip", "r2.zip", "r3.zip"]);
  });

  await step("a wrong saved password fails the copy without uploading anything", async () => {
    await offsite.save({ enabled: true, url: URL, username: USER, folder }, "wrong-password");
    const { entry } = await archive("denied.zip", 1024);
    offsite.enqueue(entry, 5); await settle();
    assert.equal(offsite.status().error?.code, "offsite_auth_failed");
    assert.equal(await remote.exists(`${folder}/${SET}/denied.zip`), false);
  });

  await step("a server request-size limit is reported as file too large and leaves no .part", async () => {
    await offsite.save({ enabled: true, url: LIMITED_URL, username: USER, folder }, PASSWORD);
    const { entry } = await archive("too-large.zip", 512 * 1024);
    offsite.enqueue(entry, 5); await settle();
    assert.equal(offsite.status().error?.code, "offsite_file_too_large", JSON.stringify(offsite.status().error));
    const listing = await remote.getDirectoryContents(`${folder}/${SET}`);
    assert.deepEqual(listing.filter((item) => item.basename.startsWith("too-large")), []);
  });

  await step("an unreachable server is reported", async () => {
    await offsite.save({ enabled: true, url: "http://127.0.0.1:9", username: USER, folder }, PASSWORD);
    const { entry } = await archive("offline.zip", 1024);
    offsite.enqueue(entry, 5); await settle();
    assert.equal(offsite.status().error?.code, "offsite_unreachable", JSON.stringify(offsite.status().error));
  });
} finally {
  await remote.deleteFile(folder).catch(() => {});
  await rm(root, { recursive: true, force: true });
  console.log(`\n${results.join("\n")}`);
  if (results.some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
}
