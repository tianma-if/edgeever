import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { isSafeResourceId } from "./resource-url.mjs";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import { canRemoveOpenedAttachment } from "./attachment-writeback.mjs";

// Only document/media formats: never hand scripts, shortcuts, executables or
// unknown file types to an OS handler. Those remain available via Download.
const OPENABLE_EXTENSIONS = new Set((
  "pdf txt md markdown csv tsv json xml log rtf doc docx odt xls xlsx ods ppt pptx odp "
  + "png jpg jpeg gif webp avif bmp tif tiff heic heif svg ico "
  + "mp3 m4a aac wav ogg flac opus aiff mp4 m4v mov webm mkv avi wmv "
  + "zip 7z rar tar gz bz2 xz epub"
).split(" "));
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const attachmentOpenInput = (input) => {
  if (typeof input?.url !== "string" || input.url.length > 1024
    || typeof input.filename !== "string" || input.filename.length > 1024) return null;
  try {
    const url = new URL(input.url);
    if (url.username || url.password || url.port || url.search || url.hash) return null;
    const staged = url.protocol === "edgeever-staged:";
    if (staged ? !url.hostname || !["", "/"].includes(url.pathname)
      : url.protocol !== "edgeever-resource:" || url.hostname !== "resource") return null;
    const id = decodeURIComponent(staged ? url.hostname : url.pathname.slice(1));
    if (!isSafeResourceId(id)) return null;
    // Treat the supplied label as a filename, never as a path. Remove Windows
    // special characters, trailing dots/spaces and Unicode direction controls.
    const base = input.filename.split(/[\\/]/).pop() || "";
    // oxlint-disable-next-line no-control-regex -- sanitize cross-platform filenames
    let filename = base.replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_")
      .trim().replace(/[. ]+$/, "");
    const extension = extname(filename);
    if (!OPENABLE_EXTENSIONS.has(extension.slice(1).toLowerCase())) return { blocked: true };
    // Bound UTF-8 length while retaining the full extension, including on Windows.
    let stem = filename.slice(0, -extension.length).replace(/[. ]+$/, "");
    while (Buffer.byteLength(stem) > 120) stem = Array.from(stem).slice(0, -1).join("");
    if (!stem || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem.normalize("NFKC"))) stem = `attachment_${stem}`;
    filename = stem + extension;
    return { url: staged ? `edgeever-staged://${id}` : `edgeever-resource://resource/${id}`, filename };
  } catch { return null; }
};

const cleanupOpenedAttachments = async (directory, onRemove) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("open-")) continue;
    const path = join(directory, entry.name);
    // Use the newer of creation and file modification times so externally edited
    // copies survive for at least a week after their last change.
    const children = await readdir(path).catch(() => []);
    const times = await Promise.all([path, ...children.map((name) => join(path, name))]
      .map((item) => stat(item).then((info) => info.mtimeMs).catch(() => Date.now())));
    if (Math.max(...times) < Date.now() - RETENTION_MS && await canRemoveOpenedAttachment(path)) {
      await rm(path, { recursive: true, force: true });
      onRemove?.(entry.name);
    }
  }
};

export const registerAttachmentOpenIpc = (ipcMain, options) => {
  const pending = new Map();
  let nameQueue = Promise.resolve();
  ipcMain.handle("desktop:open-attachment", async (event, input) => {
    try { options.authorize(event); } catch { return { ok: false, code: "forbidden" }; }
    const parsed = attachmentOpenInput(input);
    if (!parsed) return { ok: false, code: "forbidden" };
    if (parsed.blocked) return { ok: false, code: "blocked" };
    const scope = options.getScope();
    const directory = options.getDirectory();
    const key = JSON.stringify([directory, parsed.url, parsed.filename]);
    if (pending.has(key)) return pending.get(key);
    const assertCurrent = () => {
      try { options.authorize(event); } catch { throw Object.assign(new Error("Attachment open forbidden"), { code: "forbidden" }); }
      if (scope !== options.getScope()) throw Object.assign(new Error("Attachment account changed"), { code: "forbidden" });
    };
    const operation = (async () => {
      let folder;
      let response;
      let failureCode = "unavailable";
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await restrictDirectory(directory);
        assertCurrent();
        const signal = AbortSignal.timeout(120_000);
        response = await options.readResource(parsed.url, signal, assertCurrent);
        try { assertCurrent(); } catch (error) { await response.body?.cancel(); throw error; }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return { ok: false, code: "unavailable" };
        }
        // WPS rejects equal basenames even in different folders. Reserve a
        // distinct local name before releasing this short allocation queue;
        // downloads and OS opening do not need to be serialized.
        const allocation = nameQueue.then(async () => {
          assertCurrent();
          await cleanupOpenedAttachments(directory, options.writeback?.forget).catch(() => {});
          const names = new Set();
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (!entry.isDirectory() || !entry.name.startsWith("open-")) continue;
            for (const child of await readdir(join(directory, entry.name), { withFileTypes: true })) {
              if (child.isFile()) names.add(child.name.normalize("NFC").toLowerCase());
            }
          }
          const extension = extname(parsed.filename);
          const stem = parsed.filename.slice(0, -extension.length);
          let localFilename = parsed.filename;
          for (let number = 2; names.has(localFilename.normalize("NFC").toLowerCase()); number++) {
            localFilename = `${stem} (${number})${extension}`;
          }
          folder = await mkdtemp(join(directory, "open-"));
          await restrictDirectory(folder);
          const path = join(folder, localFilename);
          await writeFile(path, "", { flag: "wx", mode: 0o600 });
          return { path, localFilename };
        });
        nameQueue = allocation.catch(() => {});
        const { path, localFilename } = await allocation;
        await pipeline(response.body, createWriteStream(path, { flags: "w", mode: 0o600 }), { signal });
        await restrictFile(path);
        assertCurrent();
        await options.writeback?.track({ folder, url: parsed.url, filename: input.filename, localFilename, mimeType: response.headers.get("content-type") });
        assertCurrent();
        failureCode = "open-failed";
        const error = await options.openPath(path);
        if (error) throw new Error(error);
        // External applications can read lazily; do not remove on return/quit.
        return { ok: true };
      } catch (error) {
        await response?.body?.cancel().catch(() => {});
        if (folder) {
          options.writeback?.forget(basename(folder));
          await rm(folder, { recursive: true, force: true }).catch(() => {});
        }
        return { ok: false, code: error?.code === "forbidden" ? "forbidden" : failureCode };
      }
    })();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  });
};
