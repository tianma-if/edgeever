import { detectPublishImageMimeType, isPublishImageMimeType, PUBLISH_IMAGE_EXTENSIONS, type MemoDetail, type TiptapDoc } from "@edgeever/shared";
import type { EdgeEverRepository } from "@/lib/repository";
import { compressImageForUpload } from "@/lib/image-compression";
import { isDesktopResourceRuntime, stageDesktopResource, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { findMatchingMemoResource } from "@/lib/staged-resource-repair";
import { createSharedFileMemo, sharedFileTitle } from "@/lib/shared-file-import";
import { createWeChatChatMemo } from "@/lib/wechat-chat-import";

export type DesktopSharePayload = {
  ok: boolean;
  kind?: "file";
  reason?: string;
  importId?: string;
  title?: string;
  filename?: string;
  mimeType?: string;
  byteSize?: number;
  markdown?: string;
  media?: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
};

export type DesktopShareKind = "file" | "wechat";
type DesktopShareFailure =
  | { type: "invalid"; reason?: string }
  | { type: "save"; importId: string }
  | { type: "reveal" };

export const importDesktopShare = async (payload: DesktopSharePayload, {
  notebookId,
  repository,
  imageCompressionEnabled,
  onPending,
  onStart,
  onImported,
  onFailure,
  onFinish,
}: {
  notebookId: string | null;
  repository: Pick<EdgeEverRepository, "createMemo" | "uploadMemoResource" | "listResources" | "updateMemo" | "deleteMemo">;
  imageCompressionEnabled: boolean;
  onPending: (payload: DesktopSharePayload) => void;
  onStart: (kind: DesktopShareKind) => void;
  onImported: (memo: MemoDetail) => Promise<void>;
  onFailure: (kind: DesktopShareKind, failure: DesktopShareFailure) => void;
  onFinish: (kind: DesktopShareKind) => void;
}) => {
  const kind = payload.kind === "file" ? "file" : "wechat";
  const { importId, filename, markdown } = payload;
  if (!payload.ok || !importId || !(kind === "file" ? filename : markdown)) {
    onFailure(kind, { type: "invalid", reason: payload.reason });
    return;
  }
  if (!notebookId) {
    onPending(payload);
    return;
  }

  const bridge = window.edgeeverDesktop;
  const readFile = async (mediaId: string, fallbackName: string, fallbackType: string) => {
    const media = await bridge?.readWeChatImportMedia?.(importId, mediaId);
    if (!media?.bytes?.byteLength) throw new Error("Missing desktop share attachment");
    const bytes = new Uint8Array(media.bytes.byteLength);
    bytes.set(media.bytes);
    const name = media.filename || fallbackName;
    const type = media.mimeType || fallbackType;
    // WeChat can give PNG images a JPEG extension in the chat export.
    const detected = kind === "wechat" && isPublishImageMimeType(type)
      ? detectPublishImageMimeType(bytes.subarray(0, 64))
      : null;
    if (detected && detected !== type) {
      const filename = `${name.replace(/\.[^.]+$/, "")}.${PUBLISH_IMAGE_EXTENSIONS[detected]}`;
      return new File([bytes], filename, { type: detected });
    }
    return new File([bytes], name, { type });
  };
  const memoActions = {
    notebookId,
    createMemo: (input: Parameters<EdgeEverRepository["createMemo"]>[0]) => repository.createMemo(input),
    prepareFile: async (file: File) => imageCompressionEnabled && file.type.startsWith("image/")
      ? (await compressImageForUpload(file)).file
      : file,
    uploadResource: async (memoId: string, file: File) => {
      try {
        const { resource } = await repository.uploadMemoResource(memoId, file);
        return { url: toDesktopResourceUrl(resource.url), filename: resource.filename };
      } catch (error) {
        if (!isDesktopResourceRuntime()) throw error;
        const resources = await repository.listResources().then(({ resources }) => resources).catch(() => []);
        const existing = findMatchingMemoResource(
          resources.filter((resource) => resource.memoId === memoId),
          file.name,
          file.type.startsWith("image/") ? "image" : "attachment",
        );
        if (existing) return { url: toDesktopResourceUrl(existing.url), filename: existing.filename };
        const staged = await stageDesktopResource(memoId, file);
        if (!staged) throw error;
        return { url: `edgeever-staged://${staged.id}`, filename: file.name };
      }
    },
    updateMemo: (created: MemoDetail, content: { contentJson: TiptapDoc; contentMarkdown: string }) => repository.updateMemo(created, {
      expectedRevision: created.revision,
      expectedContentHash: created.contentHash,
      editSessionId: `${kind === "file" ? "share" : "wechat"}:${created.id}`,
      title: created.title ?? (filename && kind === "file" ? sharedFileTitle(filename) : payload.title ?? ""),
      contentJson: content.contentJson,
      contentMarkdown: content.contentMarkdown,
      tags: created.tags,
    }),
    deleteMemo: (memoId: string) => isDesktopResourceRuntime()
      ? import("@/lib/desktop-repository").then(({ cancelPendingDesktopImportMemo }) => cancelPendingDesktopImportMemo(memoId))
      : repository.deleteMemo(memoId, true),
  };

  onStart(kind);
  let resumeDesktopSync: (() => void) | undefined;
  let saved = false;
  try {
    if (isDesktopResourceRuntime()) {
      resumeDesktopSync = await (await import("@/lib/desktop-sync")).pauseDesktopSyncForImport();
    }
    const memo = kind === "file" && filename
      ? await createSharedFileMemo({
          ...memoActions,
          filename,
          file: await readFile("file", filename, payload.mimeType || "application/octet-stream"),
        })
      : await createWeChatChatMemo({
          ...memoActions,
          title: payload.title?.trim() || "",
          markdown: markdown ?? "",
          media: payload.media ?? [],
          readMedia: (item) => readFile(item.id, item.filename, item.mimeType),
        });
    saved = true;
    await bridge?.finishWeChatImport?.(importId, true).catch(() => undefined);
    await onImported(memo);
  } catch {
    if (!saved) await bridge?.finishWeChatImport?.(importId, false).catch(() => undefined);
    onFailure(kind, saved ? { type: "reveal" } : { type: "save", importId });
  } finally {
    resumeDesktopSync?.();
    onFinish(kind);
  }
};
