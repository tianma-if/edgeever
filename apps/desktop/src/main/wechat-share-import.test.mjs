import { deflateRawSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  SHARE_IMPORT_FILE_ID,
  WECHAT_INCOMING_DIRECTORY_NAME,
  createWeChatShareController,
  isFileReferencePlaceholder,
  isPathInsideDirectory,
  wechatImportFilePath,
} from "./wechat-share-import.mjs";

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const u16 = (value) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
};
const u32 = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};
const zipOf = (name, text, extraName, extra) => {
  const files = [{ name, data: Buffer.from(text) }];
  if (extraName) files.push({ name: extraName, data: Buffer.from(extra) });
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const entryName = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(compressed.length), u32(file.data.length), u16(entryName.length), u16(0),
      entryName, compressed,
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(compressed.length), u32(file.data.length), u16(entryName.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), entryName,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals, directory,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
};

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("WeChat share handoff", () => {
  test("accepts only an absolute file from the edgeever share URL", () => {
    expect(wechatImportFilePath("edgeever://wechat-import?path=/Users/me/Downloads/EdgeEver%20Incoming/a/chat.zip")).toBe(
      "/Users/me/Downloads/EdgeEver Incoming/a/chat.zip",
    );
    expect(wechatImportFilePath("edgeever://share-import?path=/Users/me/Downloads/EdgeEver%20Incoming/a/sheet.xlsx")).toBe(
      "/Users/me/Downloads/EdgeEver Incoming/a/sheet.xlsx",
    );
    expect(wechatImportFilePath("edgeever://memo/memo_1")).toBeNull();
    expect(wechatImportFilePath("https://example.com/chat.zip")).toBeNull();
    expect(wechatImportFilePath("edgeever://wechat-import?path=chat.zip")).toBeNull();
    expect(isPathInsideDirectory("/tmp/in/uuid/chat.zip", "/tmp/in")).toBe(true);
    expect(isPathInsideDirectory("/tmp/in", "/tmp/in")).toBe(false);
    expect(isPathInsideDirectory("/tmp/other/chat.zip", "/tmp/in")).toBe(false);
  });

  test("imports a zip from the incoming folder and then deletes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const temp = join(root, "temp");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录_20260922_223222.zip");
    await writeFile(zipPath, zipOf(
      "聊天记录.txt",
      "·鱼\n2026年9月22日 22:15\n[图片] 微信图片_1.jpg\n",
      "聊天记录内的图片、视频和文件/微信图片_1.jpg",
      "jpeg",
    ));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => temp,
      sendToRenderer: (payload) => sent.push(payload),
    });
    const url = `edgeever://wechat-import?path=${encodeURIComponent(zipPath)}`;
    await controller.importFromProtocolUrl(url);
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    expect(sent[0].title).toBe("聊天记录_20260922_223222");
    expect(sent[0].markdown).toContain("![微信图片_1.jpg](edgeever-wechat-media://m1)");
    const media = await controller.readMedia(sent[0].importId, "m1");
    expect(Buffer.from(media.bytes).toString()).toBe("jpeg");
    expect((await stat(zipPath)).isFile()).toBe(true);
    await controller.finish(sent[0].importId, true);
    await expect(stat(zipPath)).rejects.toThrow();
    await expect(stat(batch)).rejects.toThrow();
    await expect(readFile(join(temp, "edgeever-wechat-import", sent[0].importId, "m1.bin"))).rejects.toThrow();
  });

  test("does not read a zip outside the incoming folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const outside = join(root, "secret.zip");
    await writeFile(outside, Buffer.from("secret"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => join(root, "Downloads"),
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(outside)}`);
    expect(sent).toHaveLength(0);
    expect((await readFile(outside)).toString()).toBe("secret");
  });

  test("accepts the share extension's sandbox Downloads alias without a duplicate scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    await writeFile(zipPath, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const sandboxData = join(root, "Library", "Containers", "share", "Data");
    await mkdir(sandboxData, { recursive: true });
    await symlink(downloads, join(sandboxData, "Downloads"));
    const sandboxPath = join(sandboxData, "Downloads", WECHAT_INCOMING_DIRECTORY_NAME, "batch", "聊天记录.zip");
    const sent = [];
    const diagnostics = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
      writeDiagnostic: (event) => diagnostics.push(event),
    });
    await controller.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(sandboxPath)}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    expect(diagnostics).not.toContain("wechat-import.rejected");
    await controller.importPending();
    expect(sent).toHaveLength(1);
    await controller.finish(sent[0].importId, true);
    await expect(stat(zipPath)).rejects.toThrow();
  });

  test("rejects a link in the incoming folder that resolves outside it", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const outside = join(root, "secret.zip");
    await writeFile(outside, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const linked = join(batch, "linked.zip");
    await symlink(outside, linked);
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(linked)}`);
    expect(sent).toHaveLength(0);
    expect((await stat(outside)).isFile()).toBe(true);
  });

  test("a rejected protocol path does not report failure before a valid share is scanned", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    await writeFile(zipPath, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(join(root, "stale.zip"))}`);
    await controller.importPending();
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    await controller.finish(sent[0].importId, true);
    await expect(stat(zipPath)).rejects.toThrow();
  });

  test("reports a recognized incoming path with an invalid archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "broken.zip");
    await writeFile(zipPath, "not a zip");
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importPending();
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    expect(sent[0].kind).toBe("file");
    expect(sent[0].filename).toBe("broken.zip");
    const media = await controller.readMedia(sent[0].importId, "file");
    expect(Buffer.from(media.bytes).toString()).toBe("not a zip");
  });

  test("picks up a completed share without a protocol URL and ignores a duplicate URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    const partialPath = `${zipPath}.partial`;
    await writeFile(partialPath, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importPending();
    expect(sent).toHaveLength(0);
    await rename(partialPath, zipPath);
    const url = `edgeever://wechat-import?path=${encodeURIComponent(zipPath)}`;
    await Promise.all([controller.importPending(), controller.importFromProtocolUrl(url)]);
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    expect((await stat(zipPath)).isFile()).toBe(true);
    await controller.importFromProtocolUrl(url);
    expect(sent).toHaveLength(1);
    await controller.finish(sent[0].importId, false);
    await controller.importPending();
    expect(sent).toHaveLength(1);
    expect(controller.retry(sent[0].importId)).toBe(true);
    expect(sent).toHaveLength(2);
    await controller.finish(sent[0].importId, true);
    await expect(stat(zipPath)).rejects.toThrow();
  });

  test("skips failed shares across restarts while recovering unfinished shares", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const incoming = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const name of ["first", "second"]) {
      const batch = join(incoming, name);
      await mkdir(batch, { recursive: true });
      const zipPath = join(batch, "聊天记录.zip");
      await writeFile(zipPath, zipOf("聊天记录.txt", `·鱼\n2026年9月22日 22:15\n${name}\n`, "附件/readme.txt", "hello"));
      await utimes(batch, old, old);
    }
    const prepared = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => prepared.push(payload),
    });
    await controller.importPending();
    expect(prepared).toHaveLength(2);
    // Directory iteration order differs across filesystems; fail the named share.
    const failedShare = prepared.find((payload) => payload.markdown.includes("first"));
    expect(failedShare).toBeDefined();
    await controller.finish(failedShare.importId, false);
    const resumed = [];
    const restarted = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "new-temp"),
      sendToRenderer: (payload) => resumed.push(payload),
    });
    await restarted.importPending();
    expect(resumed).toHaveLength(1);
    expect(resumed[0].markdown).toContain("second");
    await restarted.importPending();
    expect(resumed).toHaveLength(1);
    for (const name of ["first", "second"]) {
      expect((await stat(join(incoming, name, "聊天记录.zip"))).isFile()).toBe(true);
    }
    // An explicit handoff can retry a failed share after a restart.
    const failedZip = join(incoming, "first", "聊天记录.zip");
    await restarted.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(failedZip)}`);
    expect(resumed).toHaveLength(2);
    await restarted.finish(resumed[1].importId, false);
    expect(restarted.retry(resumed[1].importId)).toBe(true);
    expect(resumed).toHaveLength(3);
    await restarted.finish(resumed[2].importId, true);
    await expect(stat(join(incoming, "first"))).rejects.toThrow();
    await expect(stat(join(incoming, "second", "聊天记录.zip"))).resolves.toBeDefined();
  });

  test("finishing one zip keeps another zip in the same incoming batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    for (const name of ["first", "second"]) {
      await writeFile(join(batch, `${name}.zip`), zipOf("聊天记录.txt", `·鱼\n2026年9月22日 22:15\n${name}\n`, "附件/readme.txt", "hello"));
    }
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importPending();
    expect(sent).toHaveLength(2);
    const first = sent.find((payload) => payload.title === "first");
    const second = sent.find((payload) => payload.title === "second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await controller.finish(first.importId, true);
    expect((await stat(join(batch, "second.zip"))).isFile()).toBe(true);
    await controller.finish(second.importId, true);
    await expect(stat(batch)).rejects.toThrow();
  });

  test("saves a shared spreadsheet as a file instead of a WeChat chat", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const filePath = join(batch, "云晰科技爆单键盘项目功能梳理表.xlsx");
    await writeFile(filePath, Buffer.from("spreadsheet"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://share-import?path=${encodeURIComponent(filePath)}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      ok: true,
      kind: "file",
      filename: "云晰科技爆单键盘项目功能梳理表.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteSize: Buffer.byteLength("spreadsheet"),
    });
    const media = await controller.readMedia(sent[0].importId, SHARE_IMPORT_FILE_ID);
    expect(Buffer.from(media.bytes).toString()).toBe("spreadsheet");
    await controller.finish(sent[0].importId, true);
    await expect(stat(filePath)).rejects.toThrow();
  });

  test("still unpacks a WeChat chat when it arrives through the file share URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    await writeFile(zipPath, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://share-import?path=${encodeURIComponent(zipPath)}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].ok).toBe(true);
    expect(sent[0].kind).toBeUndefined();
    expect(sent[0].markdown).toContain("你好");
  });

  test("reports an unsupported-only WeChat export once and retains the archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    const archive = zipOf("聊天记录.txt", "·张三\n2026年11月22日 19:25\n[不支持的消息]\n");
    await writeFile(zipPath, archive);
    const sent = [];
    const options = {
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    };
    const controller = createWeChatShareController(options);
    const url = `edgeever://share-import?path=${encodeURIComponent(zipPath)}`;
    await controller.importFromProtocolUrl(url);
    await controller.importFromProtocolUrl(url);
    await createWeChatShareController(options).importPending();
    expect(sent).toEqual([{ ok: false, reason: "unsupported-messages" }]);
    expect(await readFile(zipPath)).toEqual(archive);
  });

  test("reports a Finder file-id placeholder instead of treating it as a chat", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const zipPath = join(batch, "聊天记录.zip");
    const placeholder = Buffer.from("file:///.file/id=6571367.1215912");
    expect(isFileReferencePlaceholder(placeholder)).toBe(true);
    await writeFile(zipPath, placeholder);
    const sent = [];
    const diagnostics = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
      writeDiagnostic: (event, details) => diagnostics.push({ event, details }),
    });
    await controller.importFromProtocolUrl(`edgeever://wechat-import?path=${encodeURIComponent(zipPath)}`);
    expect(sent).toEqual([{ ok: false, kind: "file", reason: "unreadable" }]);
    await expect(stat(zipPath)).rejects.toThrow();
    expect(diagnostics).toContainEqual({ event: "share-import.rejected", details: { reason: "unreadable" } });
  });

  test("rejects a shared file larger than the configured limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const downloads = join(root, "Downloads");
    const batch = join(downloads, WECHAT_INCOMING_DIRECTORY_NAME, "batch");
    await mkdir(batch, { recursive: true });
    const filePath = join(batch, "large.pdf");
    await writeFile(filePath, Buffer.from("12345"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
      maxBytes: 4,
    });
    await controller.importFromProtocolUrl(`edgeever://share-import?path=${encodeURIComponent(filePath)}`);
    expect(sent).toEqual([{ ok: false, kind: "file", reason: "too-large" }]);
    expect((await stat(filePath)).isFile()).toBe(true);
    const restarted = createWeChatShareController({
      downloadsPath: () => downloads,
      tempPath: () => join(root, "new-temp"),
      sendToRenderer: (payload) => sent.push(payload),
      maxBytes: 4,
    });
    await restarted.importPending();
    await restarted.importPending();
    expect(sent).toHaveLength(1);
    expect((await readFile(filePath)).toString()).toBe("12345");
  });

  test("does not read a shared file outside the incoming folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const outside = join(root, "secret.xlsx");
    await writeFile(outside, Buffer.from("secret"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => join(root, "Downloads"),
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importFromProtocolUrl(`edgeever://share-import?path=${encodeURIComponent(outside)}`);
    expect(sent).toHaveLength(0);
    expect((await readFile(outside)).toString()).toBe("secret");
  });

  test("imports a local file from the Windows verb without deleting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const filePath = join(root, "功能梳理表.xlsx");
    await writeFile(filePath, Buffer.from("spreadsheet"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => join(root, "Downloads"),
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importLocalFile(filePath);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      ok: true,
      kind: "file",
      filename: "功能梳理表.xlsx",
    });
    const media = await controller.readMedia(sent[0].importId, SHARE_IMPORT_FILE_ID);
    expect(Buffer.from(media.bytes).toString()).toBe("spreadsheet");
    await controller.finish(sent[0].importId, true);
    expect((await readFile(filePath)).toString()).toBe("spreadsheet");
    await controller.importLocalFile(filePath);
    expect(sent).toHaveLength(2);
  });

  test("keeps a local WeChat zip in place after preparing the chat", async () => {
    const root = await mkdtemp(join(tmpdir(), "edgeever-wechat-share-"));
    roots.push(root);
    const zipPath = join(root, "聊天记录.zip");
    await writeFile(zipPath, zipOf("聊天记录.txt", "·鱼\n2026年9月22日 22:15\n你好\n", "附件/readme.txt", "hello"));
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => join(root, "Downloads"),
      tempPath: () => join(root, "temp"),
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importLocalFile(zipPath);
    expect(sent[0].ok).toBe(true);
    expect(sent[0].kind).toBeUndefined();
    expect(sent[0].markdown).toContain("你好");
    await controller.finish(sent[0].importId, true);
    expect((await stat(zipPath)).isFile()).toBe(true);
  });

  test("ignores a relative local path", async () => {
    const sent = [];
    const controller = createWeChatShareController({
      downloadsPath: () => "/tmp/unused-downloads",
      tempPath: () => "/tmp/unused-temp",
      sendToRenderer: (payload) => sent.push(payload),
    });
    await controller.importLocalFile("功能梳理表.xlsx");
    expect(sent).toHaveLength(0);
  });
});
