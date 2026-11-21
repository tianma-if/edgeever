import type { MemoDetail } from "@edgeever/shared";
import { isDesktopResourceRuntime, stageDesktopResource, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { compressImageForUpload } from "@/lib/image-compression";
import type { EdgeEverRepository } from "@/lib/repository";
import { createScreenshotMemo, screenshotFileFromImportPayload, screenshotImportDedupeKey, screenshotImportGate } from "@/lib/screenshot-import";
import { findMatchingMemoResource } from "@/lib/staged-resource-repair";

export type DesktopScreenshotPayload = {
  captureId?: string;
  name: string;
  type: string;
  title?: string;
  bytes: Uint8Array;
};

export const importDesktopScreenshot = async (payload: DesktopScreenshotPayload, {
  resolveNotebookId,
  repository,
  imageCompressionEnabled,
  onStart,
  onImported,
  onFailure,
}: {
  resolveNotebookId: () => Promise<string | null>;
  repository: Pick<EdgeEverRepository, "createMemo" | "uploadMemoResource" | "listResources" | "updateMemo" | "deleteMemo">;
  imageCompressionEnabled: boolean;
  onStart: () => void;
  onImported: (memo: MemoDetail) => Promise<void>;
  onFailure: (reason: "empty" | "no-notebook" | "save-failed") => void;
}) => {
  const importKey = screenshotImportDedupeKey(payload);
  if (!screenshotImportGate.tryBegin(importKey)) return;

  const file = screenshotFileFromImportPayload(payload);
  if (file.size === 0) {
    screenshotImportGate.fail();
    onFailure("empty");
    return;
  }

  const notebookId = await resolveNotebookId().catch(() => null);
  if (!notebookId) {
    screenshotImportGate.fail();
    onFailure("no-notebook");
    return;
  }

  let resumeDesktopSync: (() => void) | undefined;
  try {
    onStart();
    if (isDesktopResourceRuntime()) {
      resumeDesktopSync = await (await import("@/lib/desktop-sync")).pauseDesktopSyncForImport();
    }
    const preparedFile = imageCompressionEnabled ? (await compressImageForUpload(file)).file : file;
    const memo = await createScreenshotMemo({
      notebookId,
      title: payload.title?.trim() || "",
      file: preparedFile,
      createMemo: (input) => repository.createMemo(input),
      uploadResource: async (memoId, uploadFile) => {
        try {
          const { resource } = await repository.uploadMemoResource(memoId, uploadFile);
          return { url: toDesktopResourceUrl(resource.url), filename: resource.filename };
        } catch (error) {
          if (!isDesktopResourceRuntime()) throw error;
          const resources = await repository.listResources().then(({ resources }) => resources).catch(() => []);
          const existing = findMatchingMemoResource(
            resources.filter((resource) => resource.memoId === memoId),
            uploadFile.name,
            "image",
          );
          if (existing) return { url: toDesktopResourceUrl(existing.url), filename: existing.filename || uploadFile.name };
          const staged = await stageDesktopResource(memoId, uploadFile);
          if (!staged) throw error;
          return { url: `edgeever-staged://${staged.id}`, filename: uploadFile.name };
        }
      },
      updateMemo: (created, content) => repository.updateMemo(created, {
        expectedRevision: created.revision,
        expectedContentHash: created.contentHash,
        editSessionId: `screenshot:${created.id}`,
        title: created.title ?? "",
        contentJson: content.contentJson,
        contentMarkdown: content.contentMarkdown,
        tags: created.tags,
      }),
      deleteMemo: (memoId) => isDesktopResourceRuntime()
        ? import("@/lib/desktop-repository").then(({ cancelPendingDesktopImportMemo }) => cancelPendingDesktopImportMemo(memoId))
        : repository.deleteMemo(memoId, true),
    });
    await onImported(memo);
    screenshotImportGate.finish(importKey);
  } catch {
    screenshotImportGate.fail();
    onFailure("save-failed");
  } finally {
    resumeDesktopSync?.();
  }
};
