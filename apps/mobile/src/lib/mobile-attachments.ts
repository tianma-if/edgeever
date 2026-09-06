import type { createEdgeEverClient } from "@edgeever/client";
import { docToMarkdown, getResourceIdFromUrl, type TiptapDoc } from "@edgeever/shared";

export type MobileResourceTarget = {
  filename: string;
  href: string;
  kind: "attachment" | "image";
  resourceId: string;
};

export type MobileAttachmentTarget = MobileResourceTarget & { kind: "attachment" };
export type MobileImageTarget = MobileResourceTarget & { kind: "image" };

type AttachmentClient = Pick<ReturnType<typeof createEdgeEverClient>, "getResourceBlob">;

export type MobileResourceDownloadOptions = {
  baseUrl: string;
  token?: string | null;
};

export const buildMobileResourceDownloadRequest = (
  resourceId: string,
  options: MobileResourceDownloadOptions,
) => ({
  url: `${options.baseUrl.replace(/\/+$/, "")}/api/v1/resources/${encodeURIComponent(resourceId)}/blob`,
  headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
});

/**
 * Convert a Blob to bytes. React Native's Blob polyfill has no arrayBuffer(),
 * so calling blob.arrayBuffer() throws "undefined is not a function".
 */
export const readBlobAsUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("资源读取失败"));
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
        return;
      }
      reject(new Error("资源读取失败"));
    };
    reader.readAsArrayBuffer(blob);
  });
};

type MarkdownNodeLike = {
  attributes?: Record<string, unknown>;
  children?: MarkdownNodeLike[];
  content?: string;
  type?: string;
};

const normalizeAttachmentFilename = (label: string, resourceId: string) => {
  const withoutPrefix = label.replace(/^\s*(?:附件[：:]|Attachment:)\s*/i, "").trim();
  const colonParts = withoutPrefix.split(/[：:]\s*/).filter(Boolean);
  const candidate = (colonParts.at(-1) || withoutPrefix)
    .replace(/^[\s📎📄📦📊🗃️🗂️]+/u, "")
    .trim();
  return candidate || resourceId;
};

export const getMobileAttachmentTarget = (href: string, label: string): MobileAttachmentTarget | null => {
  const resourceId = getResourceIdFromUrl(href);
  if (!resourceId) return null;
  return {
    filename: normalizeAttachmentFilename(label, resourceId),
    href,
    kind: "attachment",
    resourceId,
  };
};

export const getMobileImageTarget = (href: string, label: string): MobileImageTarget | null => {
  const resourceId = getResourceIdFromUrl(href);
  if (!resourceId) return null;
  return {
    filename: label.trim() || `image-${resourceId}`,
    href,
    kind: "image",
    resourceId,
  };
};

export const parseMobileResourceTargetJson = (value: string): MobileResourceTarget | null => {
  try {
    const parsed = JSON.parse(value) as Partial<MobileResourceTarget>;
    if (typeof parsed.href !== "string" || typeof parsed.filename !== "string") return null;
    if (parsed.kind !== "attachment" && parsed.kind !== "image") return null;
    const resourceId = getResourceIdFromUrl(parsed.href);
    if (!resourceId || (parsed.resourceId && parsed.resourceId !== resourceId)) return null;
    return { filename: parsed.filename, href: parsed.href, kind: parsed.kind, resourceId };
  } catch {
    return null;
  }
};

export const parseMobileAttachmentTargetJson = (value: string): MobileAttachmentTarget | null => {
  const target = parseMobileResourceTargetJson(value);
  return target?.kind === "attachment" ? { ...target, kind: "attachment" } : null;
};

const getMarkdownNodeText = (node: MarkdownNodeLike): string =>
  typeof node.content === "string"
    ? node.content
    : (node.children ?? []).map(getMarkdownNodeText).join("");

export const getParagraphAttachmentTarget = (node: MarkdownNodeLike): MobileAttachmentTarget | null => {
  if (node.type !== "paragraph") return null;
  const children = node.children ?? [];
  const links = children.filter((child) => child.type === "link");
  if (links.length !== 1) return null;

  const nonLinkText = children
    .filter((child) => child.type !== "link")
    .map(getMarkdownNodeText)
    .join("")
    .trim();
  if (nonLinkText && !/^(?:附件[：:]?|Attachment:?)$/i.test(nonLinkText)) return null;

  const link = links[0];
  const href = typeof link.attributes?.href === "string" ? link.attributes.href : "";
  return getMobileAttachmentTarget(href, getMarkdownNodeText(link));
};

const hasResourceLinkMark = (value: unknown, resourceId: string) =>
  Array.isArray(value) && value.some((mark) => {
    if (!mark || typeof mark !== "object") return false;
    const candidate = mark as { attrs?: { href?: unknown }; type?: unknown };
    return candidate.type === "link" &&
      typeof candidate.attrs?.href === "string" &&
      getResourceIdFromUrl(candidate.attrs.href) === resourceId;
  });

const updateResourceDoc = (
  doc: TiptapDoc,
  target: MobileResourceTarget,
  action: { type: "delete" } | { type: "rename"; filename: string; labelPrefix: string }
): TiptapDoc => {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(visit).filter((child) => child !== null);
    }
    if (!value || typeof value !== "object") return value;

    const node = value as Record<string, unknown>;
    if (target.kind === "image" && node.type === "image") {
      const attrs = node.attrs && typeof node.attrs === "object" ? node.attrs as Record<string, unknown> : {};
      const source = typeof attrs.src === "string" ? attrs.src : "";
      if (getResourceIdFromUrl(source) === target.resourceId) {
        if (action.type === "delete") return null;
        return { ...node, attrs: { ...attrs, alt: action.filename, title: action.filename } };
      }
    }
    if (target.kind === "attachment" && node.type === "text" && hasResourceLinkMark(node.marks, target.resourceId)) {
      if (action.type === "delete") return null;
      return { ...node, text: `${action.labelPrefix}${action.filename}` };
    }

    const next = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, key === "content" ? visit(child) : child]));
    if (target.kind === "attachment" && action.type === "delete" && next.type === "paragraph" && Array.isArray(next.content)) {
      const remainingText = next.content
        .map((child) => child && typeof child === "object" && "text" in child ? String(child.text ?? "") : "")
        .join("")
        .trim();
      if (next.content.length === 0 || /^(?:附件[：:]?|Attachment:?)$/i.test(remainingText)) return null;
    }
    return next;
  };

  const updated = visit(doc) as TiptapDoc;
  return Array.isArray(updated.content) && updated.content.length > 0
    ? updated
    : { type: "doc", content: [{ type: "paragraph" }] };
};

export const renameMobileAttachmentInDoc = (
  doc: TiptapDoc,
  target: MobileAttachmentTarget,
  filename: string,
  labelPrefix: string
) => updateResourceDoc(doc, target, { type: "rename", filename, labelPrefix });

export const deleteMobileAttachmentFromDoc = (doc: TiptapDoc, target: MobileAttachmentTarget) =>
  updateResourceDoc(doc, target, { type: "delete" });

export const renameMobileResourceInDoc = (
  doc: TiptapDoc,
  target: MobileResourceTarget,
  filename: string,
  labelPrefix: string
) => updateResourceDoc(doc, target, { type: "rename", filename, labelPrefix });

export const deleteMobileResourceFromDoc = (doc: TiptapDoc, target: MobileResourceTarget) =>
  updateResourceDoc(doc, target, { type: "delete" });

export const getMobileAttachmentUpdatePayload = (contentJson: TiptapDoc) => ({
  contentJson,
  contentMarkdown: docToMarkdown(contentJson),
});

export const getMobileResourceUpdatePayload = getMobileAttachmentUpdatePayload;

const safeCacheFilename = (filename: string) =>
  filename.trim().replace(/[\\/]/g, "-").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "attachment";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/plain": ".txt",
};

const MIME_BY_EXT: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  zip: "application/zip",
};

/** Infer a usable MIME type — empty blob.type is common for RN fetch results. */
export const resolveResourceMimeType = (filename: string, blobType?: string | null) => {
  const normalized = blobType?.trim().toLowerCase() ?? "";
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] || "application/octet-stream";
};

/** SAF createFileAsync is unreliable without a file extension. */
export const resolveExportFilename = (filename: string, mimeType: string) => {
  const safe = safeCacheFilename(filename);
  if (/\.[a-z0-9]{1,8}$/i.test(safe)) {
    return safe;
  }
  return `${safe}${EXT_BY_MIME[mimeType] || ""}`;
};

export class MobileResourceCancelledError extends Error {
  readonly code = "cancelled" as const;

  constructor(message = "已取消下载") {
    super(message);
    this.name = "MobileResourceCancelledError";
  }
}

const cacheMobileResource = async (
  _client: AttachmentClient,
  target: MobileResourceTarget,
  options: MobileResourceDownloadOptions,
) => {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.cache, "edgeever-attachments");
  if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${target.resourceId}-${safeCacheFilename(target.filename)}`);
  if (file.exists) file.delete();
  const request = buildMobileResourceDownloadRequest(target.resourceId, options);
  await File.downloadFileAsync(request.url, file, {
    headers: request.headers,
    idempotent: true,
  });

  return { file };
};

const shareCachedResource = async (
  fileUri: string,
  options: { dialogTitle: string; mimeType: string }
) => {
  const Sharing = await import("expo-sharing");
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("当前设备无法打开系统分享面板");
  }
  await Sharing.shareAsync(fileUri, {
    dialogTitle: options.dialogTitle,
    mimeType: options.mimeType,
  });
  return fileUri;
};

export const openMobileResource = async (
  client: AttachmentClient,
  target: MobileResourceTarget,
  options: MobileResourceDownloadOptions,
) => {
  const { file } = await cacheMobileResource(client, target, options);
  const mimeType = resolveResourceMimeType(target.filename);
  return shareCachedResource(file.uri, {
    dialogTitle: target.filename,
    mimeType,
  });
};

/**
 * Download resource to a user-chosen folder (Android SAF) or the system share sheet.
 * Android: the action sheet Modal must be closed first — SAF needs a free activity
 * result channel; otherwise the folder picker never appears and it looks like a no-op.
 */
export const saveMobileResourceAs = async (
  client: AttachmentClient,
  target: MobileResourceTarget,
  options: MobileResourceDownloadOptions,
) => {
  const { Platform } = await import("react-native");
  const { File } = await import("expo-file-system");
  const { file } = await cacheMobileResource(client, target, options);
  const mimeType = resolveResourceMimeType(target.filename);
  const exportName = resolveExportFilename(target.filename, mimeType);

  if (Platform.OS === "android") {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) {
        // Do not return null — callers treated that as success and closed the sheet.
        throw new MobileResourceCancelledError("已取消下载");
      }
      const destination = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        exportName,
        mimeType
      );
      await file.copy(new File(destination), { overwrite: true });
      return { kind: "saf" as const, uri: destination, filename: exportName };
    } catch (error) {
      if (error instanceof MobileResourceCancelledError) {
        throw error;
      }
      // SAF is flaky on some OEM builds — fall back to the share sheet so download still works.
      await shareCachedResource(file.uri, {
        dialogTitle: `下载 ${exportName}`,
        mimeType,
      });
      return { kind: "share" as const, uri: file.uri, filename: exportName };
    }
  }

  await shareCachedResource(file.uri, {
    dialogTitle: `下载 ${exportName}`,
    mimeType,
  });
  return { kind: "share" as const, uri: file.uri, filename: exportName };
};

export const openMobileAttachment = openMobileResource;
