import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, readdir, rmdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { WeChatArchiveError, wechatChatNoteFromArchive } from "./wechat-chat-archive.mjs";

export const WECHAT_INCOMING_DIRECTORY_NAME = "EdgeEver Incoming";
export const SHARE_IMPORT_FILE_ID = "file";
export const MAX_SHARE_IMPORT_BYTES = 512 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

class ShareImportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ShareImportError";
    this.code = code;
  }
}

const extensionOf = (filename) => filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

export const mimeTypeForFilename = (filename) => MIME_TYPES[extensionOf(filename)] ?? "application/octet-stream";

// Finder's share sheet sometimes delivers `file:///.file/id=…` instead of the file.
export const isFileReferencePlaceholder = (bytes) => {
  if (!bytes || bytes.length < 16 || bytes.length > 256) return false;
  const text = Buffer.from(bytes).toString("utf8");
  return text.startsWith("file:///.file/id=") && !text.includes("\n") && !text.includes("\0");
};

export const isPathInsideDirectory = (filePath, directory) => {
  if (!filePath || !directory) return false;
  const root = resolve(directory);
  const candidate = resolve(filePath);
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
};

export const wechatImportFilePath = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "edgeever:" || (url.hostname !== "wechat-import" && url.hostname !== "share-import")) return null;
  const filePath = url.searchParams.get("path");
  if (!filePath || !isAbsolute(filePath) || filePath.includes("\0")) return null;
  return filePath;
};

const incomingDirectory = (downloadsPath) => join(downloadsPath, WECHAT_INCOMING_DIRECTORY_NAME);

// Keep the marker beside the incoming file, including when the temp directory
// is cleared. Hidden markers are never treated as shared attachments.
const failureMarkerPath = (sourcePath) => join(dirname(sourcePath),
  `.edgeever-import-failed-${createHash("sha256").update(basename(sourcePath)).digest("hex")}`);

const assertIncomingFile = async (filePath, downloadsPath) => {
  const root = incomingDirectory(downloadsPath);
  let realRoot;
  let realFile;
  try {
    [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)]);
  } catch {
    throw new WeChatArchiveError("rejected-path");
  }
  // The sandboxed share extension may name ~/Downloads through its container
  // symlink. Validate the resolved file against the resolved incoming directory.
  if (!isPathInsideDirectory(realFile, realRoot)) {
    throw new WeChatArchiveError("rejected-path");
  }
  const info = await stat(realFile).catch(() => null);
  if (!info?.isFile()) throw new WeChatArchiveError("rejected-path");
  return realFile;
};

const assertIncomingZip = async (filePath, downloadsPath) => {
  if (!filePath.toLowerCase().endsWith(".zip")) {
    throw new WeChatArchiveError("rejected-path");
  }
  const realFile = await assertIncomingFile(filePath, downloadsPath);
  if (!realFile.toLowerCase().endsWith(".zip")) {
    throw new WeChatArchiveError("rejected-path");
  }
  return realFile;
};

const wechatNoteFromBytes = (bytes, filename) => {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  try {
    return wechatChatNoteFromArchive(bytes, filename);
  } catch (error) {
    if (error instanceof WeChatArchiveError && (error.code === "invalid" || error.code === "unrecognized")) {
      return null;
    }
    throw error;
  }
};

const removeImportedZip = async (zipPath, downloadsPath) => {
  if (!zipPath) return;
  const root = await realpath(incomingDirectory(downloadsPath)).catch(() => null);
  const parent = dirname(zipPath);
  const realParent = await realpath(parent).catch(() => null);
  if (root && realParent && isPathInsideDirectory(realParent, root)) {
    await rm(zipPath, { force: true }).catch(() => {});
    await rmdir(realParent).catch(() => {});
    return;
  }
};

export const createWeChatShareController = ({
  downloadsPath,
  tempPath,
  sendToRenderer,
  onActivity = () => {},
  writeDiagnostic = () => {},
  maxBytes = MAX_SHARE_IMPORT_BYTES,
}) => {
  const sessions = new Map();
  const preparedPaths = new Set();
  const inFlightPaths = new Set();
  const completedPaths = new Set();
  const failedPaths = new Set();

  const rememberFailure = async (sourcePath) => {
    failedPaths.add(sourcePath);
    try {
      await writeFile(failureMarkerPath(sourcePath), "failed\n");
    } catch {
      void writeDiagnostic("share-import.failure-state-write-failed");
    }
  };

  const finish = async (importId, success) => {
    if (!SAFE_ID.test(importId || "")) return;
    const session = sessions.get(importId);
    if (!session) return;
    if (!success) {
      session.failed = true;
      if (!session.preserveSource) await rememberFailure(session.zipPath);
      const failedEvent = session.payload?.kind === "file" ? "share-import.save-failed" : "wechat-import.save-failed";
      void writeDiagnostic(failedEvent);
      return;
    }
    sessions.delete(importId);
    preparedPaths.delete(session.zipPath);
    if (!session.preserveSource) completedPaths.add(session.zipPath);
    failedPaths.delete(session.zipPath);
    if (!session.preserveSource) {
      await rm(failureMarkerPath(session.zipPath), { force: true }).catch(() => {});
      await removeImportedZip(session.zipPath, downloadsPath());
    }
    if (session.directory) await rm(session.directory, { recursive: true, force: true }).catch(() => {});
    const savedEvent = session.payload?.kind === "file" ? "share-import.saved" : "wechat-import.saved";
    void writeDiagnostic(savedEvent, { media: session.media.size });
  };

  const retry = (importId) => {
    if (!SAFE_ID.test(importId || "")) return false;
    const session = sessions.get(importId);
    if (!session?.failed) return false;
    session.failed = false;
    failedPaths.delete(session.zipPath);
    sendToRenderer(session.payload);
    return true;
  };

  const readMedia = async (importId, mediaId) => {
    if (!SAFE_ID.test(importId || "") || !SAFE_ID.test(mediaId || "")) {
      throw new WeChatArchiveError("rejected-path");
    }
    const session = sessions.get(importId);
    const media = session?.media.get(mediaId);
    if (!media) throw new WeChatArchiveError("missing-media");
    const bytes = await readFile(media.path);
    if (bytes.length !== media.byteSize) throw new WeChatArchiveError("invalid");
    return { filename: media.filename, mimeType: media.mimeType, bytes };
  };

  const prepareFileShare = (sourcePath, byteSize, { preserveSource = false } = {}) => {
    const filename = basename(sourcePath);
    const importId = randomUUID();
    const mimeType = mimeTypeForFilename(filename);
    const payload = {
      ok: true,
      kind: "file",
      importId,
      filename,
      mimeType,
      byteSize,
    };
    sessions.set(importId, {
      directory: null,
      media: new Map([[SHARE_IMPORT_FILE_ID, { filename, mimeType, byteSize, path: sourcePath }]]),
      zipPath: sourcePath,
      payload,
      failed: false,
      preserveSource,
    });
    if (!preserveSource) preparedPaths.add(sourcePath);
    sendToRenderer(payload);
    void writeDiagnostic("share-import.prepared", { bytes: byteSize });
  };

  const openSharedFile = async (sourcePath, { preserveSource }) => {
    let preparedDirectory = null;
    try {
      onActivity();
      const info = await stat(sourcePath);
      if (!info.isFile() || info.size <= 0) throw new ShareImportError("empty");
      if (info.size > maxBytes) throw new ShareImportError("too-large");
      const bytes = await readFile(sourcePath);
      if (isFileReferencePlaceholder(bytes)) throw new ShareImportError("unreadable");
      const note = wechatNoteFromBytes(bytes, basename(sourcePath));
      if (!note) {
        prepareFileShare(sourcePath, bytes.length, { preserveSource });
        return;
      }
      const importId = randomUUID();
      const directory = join(tempPath(), "edgeever-wechat-import", importId);
      preparedDirectory = directory;
      await mkdir(directory, { recursive: true });
      const media = new Map();
      const listed = [];
      for (const item of note.media) {
        const path = join(directory, `${item.id}.bin`);
        await writeFile(path, item.bytes);
        media.set(item.id, {
          filename: item.filename,
          mimeType: item.mimeType,
          byteSize: item.bytes.length,
          path,
        });
        listed.push({
          id: item.id,
          filename: item.filename,
          mimeType: item.mimeType,
          byteSize: item.bytes.length,
        });
      }
      const payload = {
        ok: true,
        importId,
        title: note.title,
        markdown: note.markdown,
        media: listed,
      };
      sessions.set(importId, { directory, media, zipPath: sourcePath, payload, failed: false, preserveSource });
      if (!preserveSource) preparedPaths.add(sourcePath);
      preparedDirectory = null;
      sendToRenderer(payload);
      void writeDiagnostic("wechat-import.prepared", { media: listed.length, bytes: bytes.length });
    } catch (error) {
      if (preparedDirectory) await rm(preparedDirectory, { recursive: true, force: true }).catch(() => {});
      const reason = error instanceof WeChatArchiveError || error instanceof ShareImportError
        ? error.code
        : "failed";
      if (reason === "unreadable" && sourcePath && !preserveSource) {
        await removeImportedZip(sourcePath, downloadsPath());
      } else if (sourcePath && reason !== "rejected-path" && !preserveSource) {
        await rememberFailure(sourcePath);
      }
      if (reason === "rejected-path") {
        void writeDiagnostic("wechat-import.rejected", { reason });
        return;
      }
      if (reason === "unreadable" || reason === "too-large" || reason === "empty") {
        sendToRenderer({
          ok: false,
          kind: "file",
          reason: reason === "too-large" ? "too-large" : "unreadable",
        });
        void writeDiagnostic("share-import.rejected", { reason });
        return;
      }
      const knownChatError = reason === "unrecognized" || reason === "unsupported-messages";
      sendToRenderer({ ok: false, reason: knownChatError ? reason : "failed" });
      void writeDiagnostic("wechat-import.rejected", { reason });
    }
  };

  const importFromProtocolUrl = async (value) => {
    const requestedPath = wechatImportFilePath(value);
    if (!requestedPath) return;
    let shareFile = false;
    try {
      shareFile = new URL(value).hostname === "share-import";
    } catch {
      return;
    }
    const downloads = downloadsPath();
    let sourcePath = null;
    try {
      sourcePath = shareFile
        ? await assertIncomingFile(requestedPath, downloads)
        : await assertIncomingZip(requestedPath, downloads);
      if (inFlightPaths.has(sourcePath) || preparedPaths.has(sourcePath)
        || completedPaths.has(sourcePath) || failedPaths.has(sourcePath)) return;
      inFlightPaths.add(sourcePath);
      await openSharedFile(sourcePath, { preserveSource: false });
    } catch (error) {
      const reason = error instanceof WeChatArchiveError ? error.code : "failed";
      if (reason !== "rejected-path" && sourcePath) await rememberFailure(sourcePath);
      if (reason !== "rejected-path") {
        sendToRenderer({ ok: false, reason: "failed" });
      }
      void writeDiagnostic("wechat-import.rejected", { reason });
    } finally {
      if (sourcePath) inFlightPaths.delete(sourcePath);
    }
  };

  const localInFlight = new Set();
  const importLocalFile = async (filePath) => {
    if (typeof filePath !== "string" || !isAbsolute(filePath) || filePath.includes("\0")) return;
    let sourcePath = null;
    try {
      sourcePath = await realpath(filePath);
    } catch {
      sendToRenderer({ ok: false, kind: "file", reason: "unreadable" });
      void writeDiagnostic("share-import.rejected", { reason: "unreadable" });
      return;
    }
    if (localInFlight.has(sourcePath)) return;
    localInFlight.add(sourcePath);
    try {
      await openSharedFile(sourcePath, { preserveSource: true });
    } finally {
      localInFlight.delete(sourcePath);
    }
  };

  const importPending = async () => {
    const root = incomingDirectory(downloadsPath());
    const batches = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const batch of batches) {
      if (!batch.isDirectory()) continue;
      const directory = join(root, batch.name);
      const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || file.name.startsWith(".") || file.name.toLowerCase().endsWith(".partial")) continue;
        const sourcePath = join(directory, file.name);
        if (await stat(failureMarkerPath(sourcePath)).then(() => true, () => false)) continue;
        const url = new URL(file.name.toLowerCase().endsWith(".zip") ? "edgeever://wechat-import" : "edgeever://share-import");
        url.searchParams.set("path", sourcePath);
        await importFromProtocolUrl(url.href);
      }
    }
  };

  return { importFromProtocolUrl, importLocalFile, importPending, readMedia, finish, retry };
};
