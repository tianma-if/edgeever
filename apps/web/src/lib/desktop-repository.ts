import { memoLocalSnapshot } from "./local-memo-guard";
import type {
  DesktopMemoCreateParams,
  DesktopMemoListParams,
  DesktopMemoUpdateParams,
  DesktopRpcMethod,
  DesktopRpcParams,
  DesktopRpcResponses,
} from "@edgeever/shared";
import {
  docToMarkdown,
  docToText,
  getImageOnlyDocumentImages,
  markdownToDoc,
  MERGE_DIVIDER_MARKDOWN_MARKER,
  MERGE_DIVIDER_NODE_TYPE,
  mergeMemoDocs,
  resolveMemoContentDoc,
  type MemoDetail,
} from "@edgeever/shared";
import { localizeDefaultMemoTemplate } from "@edgeever/shared/memo-template-seeds";
import type { EdgeEverRepository } from "@/lib/repository";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { createStagedResourceListItem, mapMarkdownResourceUrls, mapTiptapResourceUrls, toApiResourceUrl, toDesktopResourceUrl } from "@/lib/desktop-resources";
import {
  applyStagedResourceUrlRewrites,
  collectStagedResourceReferences,
  contentReferencesStagedResourceUrl,
  repairMemoStagedResourceUrls,
  stagedResourceIdFromUrl,
} from "@/lib/staged-resource-repair";
import type { ResourceListItem, ResourceStorageSummary } from "@edgeever/shared";
import { notifySyncQueueDeferred } from "@/lib/sync-events";

const resolveResourceUrls = <T extends { resources: Array<{ url: string }> }>(result: T): T => {
  const baseUrl = getConfiguredDesktopApiBaseUrl();
  return {
    ...result,
    resources: result.resources.map((resource) => ({ ...resource, url: toDesktopResourceUrl(resource.url.startsWith("/") ? `${baseUrl}${resource.url}` : resource.url) })),
  };
};

const toDisplayMemo = (memo: MemoDetail): MemoDetail => ({
  ...memo,
  contentJson: mapTiptapResourceUrls(memo.contentJson, toDesktopResourceUrl),
  contentMarkdown: mapMarkdownResourceUrls(memo.contentMarkdown, toDesktopResourceUrl) ?? "",
});

// The sidecar's local merge stores one plain paragraph per Markdown line,
// with real divider nodes between sources. Recover the body before rewriting
// resource URLs so the paragraphs and Markdown can be compared verbatim.
const recoverDesktopMerge = (memo: MemoDetail): MemoDetail => {
  const { contentJson, contentMarkdown, mergeSourceCount } = memo;
  if (!(mergeSourceCount >= 2) || !contentMarkdown?.includes(MERGE_DIVIDER_MARKDOWN_MARKER)) return memo;

  const lines = contentMarkdown.split(/\r?\n/).filter((line) => line.trim());
  let lineIndex = 0;
  let dividerCount = 0;
  const nodes = contentJson?.content ?? [];
  const matchesSidecarDocument = nodes.every((node, index) => {
    if (node.type === MERGE_DIVIDER_NODE_TYPE && Object.keys(node).length === 1) {
      dividerCount++;
      return lines[lineIndex++] === MERGE_DIVIDER_MARKDOWN_MARKER && lines[lineIndex++] === "---";
    }
    if (node.type !== "paragraph") return false;
    if (Object.keys(node).length === 1) {
      // markdown_doc emits a single empty paragraph for an empty source.
      return (index === 0 || nodes[index - 1]?.type === MERGE_DIVIDER_NODE_TYPE)
        && (index === nodes.length - 1 || nodes[index + 1]?.type === MERGE_DIVIDER_NODE_TYPE);
    }
    const text = node.content?.[0];
    return Object.keys(node).length === 2 && node.content?.length === 1
      && text?.type === "text" && Object.keys(text).length === 2
      && "text" in text && text.text === lines[lineIndex++];
  });
  if (!matchesSidecarDocument || dividerCount !== mergeSourceCount - 1 || lineIndex !== lines.length) return memo;

  const recovered = markdownToDoc(contentMarkdown);
  // An unfinished block in one source can consume the separator and the next source.
  if (recovered.content.filter((node) => node.type === MERGE_DIVIDER_NODE_TYPE).length < dividerCount) return memo;
  return { ...memo, contentJson: recovered };
};

const liveStagedIdsForMemo = async (memoId: string) => {
  const staged = await listStagedResources();
  return new Set(
    staged
      .filter((resource) => resource.memoId === memoId)
      .map((resource) => stagedResourceIdFromUrl(resource.url))
      .filter((id): id is string => Boolean(id)),
  );
};

const resourcesForMemo = async (memoId: string) => {
  const listed = await request("resource.list", { limit: 500 });
  return listed.resources.filter((resource) => resource.memoId === memoId);
};

const rewriteUploadedAliases = async <T extends { contentJson?: unknown; contentMarkdown?: string | null }>(memoId: string, memo: T): Promise<T> => {
  const aliases = await window.edgeeverDesktop?.listStagedResourceAliases?.(memoId) ?? [];
  if (aliases.length === 0) return memo;
  const rewrites = aliases.map((item) => ({
    placeholder: `edgeever-staged://${item.id}`,
    url: `/api/v1/resources/${encodeURIComponent(item.resourceId)}/blob`,
  }));
  return {
    ...memo,
    contentJson: applyStagedResourceUrlRewrites(memo.contentJson, rewrites) as T["contentJson"],
    contentMarkdown: typeof memo.contentMarkdown === "string"
      ? applyStagedResourceUrlRewrites(memo.contentMarkdown, rewrites) as string
      : memo.contentMarkdown,
  };
};

const repairDisplayedMemo = async (storedMemo: MemoDetail): Promise<MemoDetail> => {
  const memo = recoverDesktopMerge(storedMemo);
  if (
    !contentReferencesStagedResourceUrl(memo.contentJson)
    && !contentReferencesStagedResourceUrl(memo.contentMarkdown)
  ) {
    return toDisplayMemo(memo);
  }
  const aliased = await rewriteUploadedAliases(memo.id, memo);
  if (!contentReferencesStagedResourceUrl(aliased.contentJson)
    && !contentReferencesStagedResourceUrl(aliased.contentMarkdown)) return toDisplayMemo(aliased);
  const [resources, liveStagedIds] = await Promise.all([resourcesForMemo(memo.id), liveStagedIdsForMemo(memo.id)]);
  return toDisplayMemo(repairMemoStagedResourceUrls(aliased, resources, liveStagedIds));
};

const listStagedResources = async (): Promise<ResourceListItem[]> => {
  const bridge = window.edgeeverDesktop;
  if (!bridge?.isAvailable) return [];
  const staged = await bridge.listStagedResources();
  const now = new Date().toISOString();
  return staged.map((item) => createStagedResourceListItem(item, now));
};

const mergeStagedResources = async <T extends { resources: ResourceListItem[]; summary: ResourceStorageSummary }>(result: T): Promise<T> => {
  const staged = await listStagedResources();
  if (staged.length === 0) return result;
  const stagedSummary: ResourceStorageSummary = {
    totalCount: staged.length,
    totalBytes: staged.reduce((total, resource) => total + resource.byteSize, 0),
    imageCount: staged.filter((resource) => resource.kind === "image").length,
    attachmentCount: staged.filter((resource) => resource.kind === "attachment").length,
  };
  return {
    ...result,
    resources: [...staged, ...result.resources],
    summary: {
      totalCount: result.summary.totalCount + stagedSummary.totalCount,
      totalBytes: result.summary.totalBytes + stagedSummary.totalBytes,
      imageCount: result.summary.imageCount + stagedSummary.imageCount,
      attachmentCount: result.summary.attachmentCount + stagedSummary.attachmentCount,
    },
  };
};

const request = async <M extends DesktopRpcMethod>(method: M, params: DesktopRpcParams[M]) => {
  const bridge = window.edgeeverDesktop;
  if (!bridge?.isAvailable) throw new Error("EdgeEver desktop bridge is unavailable");
  return bridge.sidecarRequest<DesktopRpcResponses[M]>(method, params);
};

const prepareDesktopMergeContent = async (memoIds: string[]): Promise<NonNullable<DesktopRpcParams["memo.merge"]["preparedContent"]>> => {
  if (memoIds.length < 2) throw new Error("At least two memos are required to merge.");
  const sources = await Promise.all(memoIds.map(async (memoId) => (await request("memo.get", { memoId })).memo));
  const docs = sources.map((storedMemo) => {
    const memo = recoverDesktopMerge(storedMemo);
    const doc = resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
    if (!docToText(doc).trim() && memo.contentText.trim() && !getImageOnlyDocumentImages(doc)) {
      throw new Error("Source note content could not be recovered safely. Merge was cancelled.");
    }
    return doc;
  });
  const contentJson = mapTiptapResourceUrls(mergeMemoDocs(docs), toApiResourceUrl);
  return {
    sources: sources.map(({ id, revision, contentHash }) => ({ id, revision, contentHash })),
    contentJson,
    contentMarkdown: docToMarkdown(contentJson),
    contentText: docToText(contentJson),
  };
};

export const cancelPendingDesktopImportMemo = async (memoId: string) => {
  const result = await request("memo.delete", { memoId, permanent: true, cancelPendingCreate: true });
  window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
  return result;
};

export const createDesktopRepository = (): EdgeEverRepository => ({
  listNotebooks: () => request("notebook.list", {}),

  createNotebook: (input) => request("notebook.create", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  updateNotebook: (notebookId, input) => request("notebook.update", { notebookId, ...input }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  deleteNotebook: (notebookId) => request("notebook.delete", { notebookId }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  trashNotebook: (notebookId) => request("notebook.trash", { notebookId }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  restoreNotebook: (notebookId) => request("notebook.restore", { notebookId }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  listTemplates: async () => {
    const local = await request("template.list", {});
    const refresh = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const remote = await api.listTemplates();
        await Promise.all(remote.templates.map((template) => request("template.cache", { template })));
      } catch {
        // The local snapshot remains the durable fallback for the next open.
      }
    };
    if (local.templates.length > 0) {
      void refresh();
      return local;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return local;
    const remote = await api.listTemplates();
    await Promise.all(remote.templates.map((template) => request("template.cache", { template })));
    return remote;
  },
  createTemplate: (input) => request("template.create", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  updateTemplate: (templateId, input) => request("template.update", { templateId, ...input }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  deleteTemplate: (templateId) => request("template.delete", { templateId }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  useTemplate: async (templateId, notebookId, locale) => {
    const templates = await createDesktopRepository().listTemplates();
    const stored = templates.templates.find((candidate) => candidate.id === templateId);
    if (!stored) throw new Error(`Template not found: ${templateId}`);
    const template = locale ? localizeDefaultMemoTemplate(stored, locale) : stored;
    return createDesktopRepository().createMemo({ notebookId, title: template.title ?? "", contentMarkdown: template.contentMarkdown, tags: template.tags });
  },
  uploadMemoResource: async (memoId, file) => {
    const result = await api.uploadMemoResource(memoId, file);
    await request("resource.cache", { resource: result.resource });
    return { resource: { ...result.resource, url: toDesktopResourceUrl(result.resource.url) } };
  },

  readResource: async (resourceId) => (
    await api.getResourceResponse(`/api/v1/resources/${encodeURIComponent(resourceId)}/blob`, { cache: "no-store" })
  ).blob(),

  updateResource: async (resourceId, file, expectedContentHash) => {
    const result = await api.updateResourceContent(resourceId, file, expectedContentHash);
    await request("resource.delete", { resourceId });
    await request("resource.cache", { resource: result.resource });
    return { resource: { ...result.resource, url: toDesktopResourceUrl(result.resource.url) } };
  },

  listResources: async () => {
    const local = await request("resource.list", { limit: 500 });
    const staged = await listStagedResources();
    const localResult = () => mergeStagedResources(resolveResourceUrls(local));
    const refresh = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const remote = await api.listResources();
        await Promise.all(remote.resources.map((resource) => request("resource.cache", { resource })));
      } catch {
        // Keep the last local resource index available for offline and startup use.
      }
    };
    if (local.resources.length > 0 || staged.length > 0) {
      void refresh();
      return localResult();
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return localResult();
    try {
      const remote = await api.listResources();
      await Promise.all(remote.resources.map((resource) => request("resource.cache", { resource })));
      return mergeStagedResources(resolveResourceUrls(remote));
    } catch (error) {
      if (staged.length > 0) {
        return mergeStagedResources({ resources: [], summary: { totalCount: 0, totalBytes: 0, imageCount: 0, attachmentCount: 0 } });
      }
      throw error;
    }
  },
  renameResource: async (resourceId, filename) => {
    const result = await api.renameResource(resourceId, filename);
    await request("resource.cache", { resource: result.resource });
    return { resource: { ...result.resource, url: toDesktopResourceUrl(result.resource.url) } };
  },
  deleteResource: async (resourceId) => {
    const result = await api.deleteResource(resourceId);
    await request("resource.delete", { resourceId });
    return result;
  },
  listTags: () => request("tag.list", {}),
  renameTag: (tag, name) => request("tag.rename", { tag, name }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  deleteTag: (tag) => request("tag.delete", { tag }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  moveMemos: (input) => request("memo.moveBatch", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  deleteMemos: (input) => request("memo.deleteBatch", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  emptyTrash: () => request("memo.emptyTrash", {}).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  pinMemos: (input) => request("memo.pinBatch", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),
  mergeMemos: async (input) => {
    const memoIds = [...new Set(input.memoIds)];
    const { memo } = await request("memo.merge", {
      ...input,
      memoIds,
      preparedContent: await prepareDesktopMergeContent(memoIds),
    });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo: await repairDisplayedMemo(memo) };
  },

  duplicateMemo: async (memoId, input = {}) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("memo_duplicate_offline");
    // The server copies the note, so its local edits are synchronized first.
    const { syncDesktopData } = await import("@/lib/desktop-sync");
    await syncDesktopData();
    // The sidecar lists at most 200 outbox items, so a change of this note
    // further down the queue cannot be seen. Duplicate only when the whole
    // outstanding queue was listed and none of it belongs to this note.
    const [status, outbox] = await Promise.all([
      request("sync.status", {}),
      request("sync.outbox.list", { limit: 200, includeConflicts: true }),
    ]);
    const outstanding = status.pending + status.error + status.conflict;
    if (
      status.syncing > 0
      || outbox.items.length < outstanding
      || outbox.items.some((item) => item.entityId === memoId)
    ) {
      throw new Error("memo_duplicate_pending_changes");
    }
    const result = await api.duplicateMemo(memoId, input);
    await request("sync.apply", {
      changes: [{ entityType: "memo", operation: "upsert", entityId: result.memo.id, memo: result.memo, notebook: null }],
    });
    return { memo: await repairDisplayedMemo((await request("memo.get", { memoId: result.memo.id, includeDeleted: false })).memo) };
  },

  listMemos: (params) => {
    const rpcParams: DesktopMemoListParams = {
      ...params,
      notebookId: params.notebookIds?.length ? null : (params.notebookId ?? null),
    };
    return request("memo.list", rpcParams);
  },

  getMemo: async (memoId, includeDeleted = false) => {
    const result = await request("memo.get", { memoId, includeDeleted });
    return { memo: await repairDisplayedMemo(result.memo) };
  },

  createMemo: (input) => {
    // The sidecar fallback wraps raw lines as paragraphs; parse Markdown here
    // with the same schema used by the editor before persisting a new note.
    const contentJson = input.contentJson ?? markdownToDoc(input.contentMarkdown ?? "");
    const rpcParams: DesktopMemoCreateParams = {
      ...input,
      contentJson,
      contentMarkdown: mapMarkdownResourceUrls(input.contentMarkdown, toApiResourceUrl),
      contentText: docToText(contentJson),
    };
    return request("memo.create", rpcParams).then((result) => {
      window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
      return result;
    });
  },

  updateMemo: async (memo: MemoDetail, input, options) => {
    const needsStagedRepair = contentReferencesStagedResourceUrl(input.contentJson)
      || contentReferencesStagedResourceUrl(input.contentMarkdown);
    const aliasedInput = needsStagedRepair
      ? await rewriteUploadedAliases(memo.id, { contentJson: input.contentJson, contentMarkdown: input.contentMarkdown })
      : input;
    const repairedInput = contentReferencesStagedResourceUrl(aliasedInput.contentJson)
      || contentReferencesStagedResourceUrl(aliasedInput.contentMarkdown)
      ? repairMemoStagedResourceUrls(aliasedInput, ...(await Promise.all([resourcesForMemo(memo.id), liveStagedIdsForMemo(memo.id)])))
      : aliasedInput;
    if (contentReferencesStagedResourceUrl(repairedInput.contentJson)
      || contentReferencesStagedResourceUrl(repairedInput.contentMarkdown)) {
      const live = new Set((await window.edgeeverDesktop?.listStagedResources() ?? []).map((item) => item.id));
      const references = collectStagedResourceReferences(repairedInput);
      if (references.length === 0 || references.some((reference) => !live.has(reference.stagedId))) {
        throw new Error("Memo contains a missing staged resource");
      }
    }
    const portableContentJson = mapTiptapResourceUrls(repairedInput.contentJson ?? input.contentJson, toApiResourceUrl);
    const contentMarkdown = repairedInput.contentMarkdown === undefined && input.contentMarkdown === undefined
      ? docToMarkdown(portableContentJson)
      : mapMarkdownResourceUrls(
        typeof repairedInput.contentMarkdown === "string" ? repairedInput.contentMarkdown : input.contentMarkdown,
        toApiResourceUrl,
      );
    const rpcParams: DesktopMemoUpdateParams & { contentText: string } = {
      memoId: memo.id,
      expectedRevision: memo.revision,
      expectedContentHash: memo.contentHash,
      title: input.title,
      contentJson: portableContentJson,
      contentMarkdown,
      contentText: docToText(portableContentJson),
      tags: input.tags,
    };
    let result;
    if (options?.guardLocalSnapshot) {
      const snapshot = memoLocalSnapshot(memo);
      try {
        result = await request("memo.updateGuarded", {
          ...rpcParams,
          expectedLocalSnapshot: { ...snapshot,
            contentJson: mapTiptapResourceUrls(snapshot.contentJson, toApiResourceUrl),
            contentMarkdown: mapMarkdownResourceUrls(snapshot.contentMarkdown, toApiResourceUrl) ?? snapshot.contentMarkdown,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("NOTE_CONFLICT:")) throw Object.assign(new Error(message), { code: "NOTE_CONFLICT" });
        if (message.includes("Unknown sidecar method: memo.updateGuarded")) throw Object.assign(new Error("Upgrade the desktop host before using guarded plugin note edits."), { code: "HOST_UPGRADE_REQUIRED" });
        throw error;
      }
    } else {
      result = await request("memo.update", rpcParams);
    }
    notifySyncQueueDeferred();
    return { memo: await repairDisplayedMemo(result.memo), queued: true as const };
  },

  adoptCloudMemo: async (memoId) => {
    const { discardDesktopMemoConflict } = await import("@/lib/desktop-sync");
    const memo = await discardDesktopMemoConflict(memoId);
    return { memo: await repairDisplayedMemo(memo) };
  },

  deleteMemo: (memoId, permanent = false) => request("memo.delete", { memoId, permanent }).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return result;
  }),

  restoreMemo: async (memoId) => {
    const result = await request("memo.restore", { memoId });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ...result, queued: true as const };
  },

  listMemoRevisions: async (memoId) => {
    const local = await request("memo.revisions", { memoId, limit: 100 });
    if (typeof navigator !== "undefined" && !navigator.onLine) return local;
    try {
      const remote = await api.listMemoRevisions(memoId);
      await Promise.all(remote.revisions.map((revision) => request("memo.revision.cache", { revision })));
      return remote;
    } catch (error) {
      if (local.revisions.length > 0) return local;
      throw error;
    }
  },
  restoreMemoRevision: async (memoId, revisionId) => {
    const result = await request("memo.restoreRevision", { memoId, revisionId });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo: toDisplayMemo(result.memo) };
  },

  sync: async () => ({ bootstrapped: false, changed: 0 }),
});
