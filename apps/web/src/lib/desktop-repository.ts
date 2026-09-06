import type {
  DesktopMemoCreateParams,
  DesktopMemoListParams,
  DesktopMemoUpdateParams,
  DesktopRpcMethod,
  DesktopRpcParams,
  DesktopRpcResponses,
} from "@edgeever/shared";
import { docToMarkdown, docToText, type MemoDetail } from "@edgeever/shared";
import type { EdgeEverRepository } from "@/lib/repository";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { createStagedResourceListItem, mapMarkdownResourceUrls, mapTiptapResourceUrls, toApiResourceUrl, toDesktopResourceUrl } from "@/lib/desktop-resources";
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
    try {
      const remote = await api.listTemplates();
      await Promise.all(remote.templates.map((template) => request("template.cache", { template })));
      return remote;
    } catch (error) {
      throw error;
    }
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
  useTemplate: async (templateId, notebookId) => {
    const templates = await createDesktopRepository().listTemplates();
    const template = templates.templates.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);
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
  mergeMemos: (input) => request("memo.merge", input).then((result) => {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo: toDisplayMemo(result.memo) };
  }),

  listMemos: (params) => {
    const rpcParams: DesktopMemoListParams = {
      ...params,
      notebookId: params.notebookIds?.length ? null : (params.notebookId ?? null),
    };
    return request("memo.list", rpcParams);
  },

  getMemo: async (memoId, includeDeleted = false) => {
    const result = await request("memo.get", { memoId, includeDeleted });
    return { memo: toDisplayMemo(result.memo) };
  },

  createMemo: (input) => {
    const rpcParams: DesktopMemoCreateParams = {
      ...input,
      contentMarkdown: mapMarkdownResourceUrls(input.contentMarkdown, toApiResourceUrl),
      contentText: input.contentJson ? docToText(input.contentJson) : undefined,
    };
    return request("memo.create", rpcParams).then((result) => {
      window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
      return result;
    });
  },

  updateMemo: async (memo: MemoDetail, input) => {
    const portableContentJson = mapTiptapResourceUrls(input.contentJson, toApiResourceUrl);
    const contentMarkdown = input.contentMarkdown === undefined
      ? docToMarkdown(portableContentJson)
      : mapMarkdownResourceUrls(input.contentMarkdown, toApiResourceUrl);
    const rpcParams: DesktopMemoUpdateParams & { contentText: string } = {
      memoId: memo.id,
      expectedRevision: memo.revision,
      expectedContentHash: memo.contentHash,
      title: input.title,
      contentJson: portableContentJson,
      contentMarkdown,
      contentText: docToText(input.contentJson),
      tags: input.tags,
    };
    const result = await request("memo.update", rpcParams);
    notifySyncQueueDeferred();
    return { memo: toDisplayMemo(result.memo), queued: true as const };
  },

  adoptCloudMemo: async (memoId) => {
    const { discardDesktopMemoConflict } = await import("@/lib/desktop-sync");
    const memo = await discardDesktopMemoConflict(memoId);
    return { memo: toDisplayMemo(memo) };
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
