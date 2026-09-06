import type { createEdgeEverClient } from "@edgeever/client";
import { clearMobileMemoDraft } from "./mobile-drafts";
import { deleteLocalMemo, resolveLocalMemo, softDeleteLocalMemo, upsertLocalMemo } from "./local-mirror";
import { cancelMobileMemoQueueItems, listMobileSyncQueueItems } from "./sync-queue";

type MobileClient = ReturnType<typeof createEdgeEverClient>;

const isLocalTemporaryId = (memoId: string) => memoId.startsWith("local:");

/**
 * Delete notes from the mobile client.
 *
 * Offline-created notes (`local:…` / pending `memo.create`) never hit the
 * server — cancel their queue work and drop the local mirror row.
 * Synced notes soft-delete (or permanently delete) on the API and update the
 * local mirror optimistically so the list updates immediately.
 */
export const deleteMobileMemos = async ({
  client,
  dataScope,
  syncQueueScope,
  memoIds,
  permanent = false,
}: {
  client: MobileClient | null;
  dataScope: string;
  syncQueueScope: string;
  memoIds: string[];
  permanent?: boolean;
}): Promise<{ deleted: number; localOnly: number; remote: number }> => {
  const uniqueIds = Array.from(new Set(memoIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { deleted: 0, localOnly: 0, remote: 0 };
  }

  const queueItems = await listMobileSyncQueueItems(syncQueueScope);
  const pendingCreateIds = new Set(
    queueItems.filter((item) => item.kind === "memo.create").map((item) => item.memoId)
  );

  const localOnlyIds: string[] = [];
  const remoteIds: string[] = [];

  for (const memoId of uniqueIds) {
    if (pendingCreateIds.has(memoId) || isLocalTemporaryId(memoId)) {
      if (isLocalTemporaryId(memoId) && !pendingCreateIds.has(memoId)) {
        const resolved = await resolveLocalMemo(dataScope, memoId);
        if (resolved && !isLocalTemporaryId(resolved.id) && !pendingCreateIds.has(resolved.id)) {
          remoteIds.push(resolved.id);
          continue;
        }
      }
      localOnlyIds.push(memoId);
      continue;
    }
    remoteIds.push(memoId);
  }

  for (const memoId of localOnlyIds) {
    await cancelMobileMemoQueueItems(syncQueueScope, memoId);
    await deleteLocalMemo(dataScope, memoId);
    await clearMobileMemoDraft(memoId);
  }

  const uniqueRemoteIds = Array.from(new Set(remoteIds));
  if (uniqueRemoteIds.length > 0) {
    if (!client) {
      throw new Error("当前无法连接实例，请稍后重试");
    }
    const originalMemos = new Map(
      (await Promise.all(uniqueRemoteIds.map(async (memoId) => [memoId, await resolveLocalMemo(dataScope, memoId)] as const)))
        .filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]))
    );
    await Promise.all(
      uniqueRemoteIds.map((memoId) => permanent
        ? deleteLocalMemo(dataScope, memoId)
        : softDeleteLocalMemo(dataScope, memoId))
    );
    try {
      if (uniqueRemoteIds.length === 1) {
        await client.deleteMemo(uniqueRemoteIds[0]!, { permanent });
      } else {
        await client.deleteMemos({ memoIds: uniqueRemoteIds, permanent });
      }
    } catch (error) {
      await Promise.all(Array.from(originalMemos.values()).map((memo) => upsertLocalMemo(dataScope, memo)));
      throw error;
    }
    await Promise.all(uniqueRemoteIds.map((memoId) => clearMobileMemoDraft(memoId)));
  }

  return {
    deleted: localOnlyIds.length + uniqueRemoteIds.length,
    localOnly: localOnlyIds.length,
    remote: uniqueRemoteIds.length,
  };
};
