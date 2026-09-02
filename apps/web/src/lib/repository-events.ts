import type { MemoDetail, MemoTemplate, Resource } from "@edgeever/shared";
import type { EdgeEverRepository } from "@/lib/repository";

export type RepositoryMutationEvent =
  | { type: "note.created"; note: MemoDetail }
  | { type: "note.updated"; note: MemoDetail }
  | { type: "note.deleted"; noteId: string }
  | { type: "tag.changed"; previousName?: string; name?: string; deleted?: boolean }
  | { type: "template.created"; template: MemoTemplate }
  | { type: "template.updated"; template: MemoTemplate }
  | { type: "template.deleted"; templateId: string }
  | { type: "resource.created"; resource: Resource }
  | { type: "resource.updated"; resource: Resource }
  | { type: "resource.deleted"; resourceId: string }
  | { type: "workspace.synced"; bootstrapped: boolean; changed: number };

type RepositoryMutationListener = (event: RepositoryMutationEvent) => void;

const listenersByScope = new Map<string, Set<RepositoryMutationListener>>();

export const notifyRepositoryMutation = (scope: string, event: RepositoryMutationEvent) => {
  for (const listener of listenersByScope.get(scope) ?? []) listener(event);
};

export const subscribeRepositoryMutations = (scope: string, listener: RepositoryMutationListener) => {
  const listeners = listenersByScope.get(scope) ?? new Set<RepositoryMutationListener>();
  listeners.add(listener);
  listenersByScope.set(scope, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByScope.delete(scope);
  };
};

export const withRepositoryMutationEvents = (repository: EdgeEverRepository, scope: string): EdgeEverRepository => ({
  ...repository,
  async createMemo(input) {
    const result = await repository.createMemo(input);
    notifyRepositoryMutation(scope, { type: "note.created", note: result.memo });
    return result;
  },
  async updateMemo(memo, input) {
    const result = await repository.updateMemo(memo, input);
    notifyRepositoryMutation(scope, { type: "note.updated", note: result.memo });
    return result;
  },
  async deleteMemo(noteId, permanent) {
    const result = await repository.deleteMemo(noteId, permanent);
    notifyRepositoryMutation(scope, { type: "note.deleted", noteId });
    return result;
  },
  async restoreMemo(noteId) {
    const result = await repository.restoreMemo(noteId);
    notifyRepositoryMutation(scope, { type: "note.updated", note: result.memo });
    return result;
  },
  async restoreMemoRevision(noteId, revisionId) {
    const result = await repository.restoreMemoRevision(noteId, revisionId);
    notifyRepositoryMutation(scope, { type: "note.updated", note: result.memo });
    return result;
  },
  async useTemplate(templateId, notebookId) {
    const result = await repository.useTemplate(templateId, notebookId);
    notifyRepositoryMutation(scope, { type: "note.created", note: result.memo });
    return result;
  },
  async uploadMemoResource(memoId, file) {
    const result = await repository.uploadMemoResource(memoId, file);
    notifyRepositoryMutation(scope, { type: "resource.created", resource: result.resource });
    return result;
  },
  async updateResource(resourceId, file, expectedContentHash) {
    const result = await repository.updateResource(resourceId, file, expectedContentHash);
    notifyRepositoryMutation(scope, { type: "resource.updated", resource: result.resource });
    return result;
  },
  async renameResource(resourceId, filename) {
    const result = await repository.renameResource(resourceId, filename);
    notifyRepositoryMutation(scope, { type: "resource.updated", resource: result.resource });
    return result;
  },
  async deleteResource(resourceId) {
    const result = await repository.deleteResource(resourceId);
    notifyRepositoryMutation(scope, { type: "resource.deleted", resourceId });
    return result;
  },
  async createTemplate(input) {
    const result = await repository.createTemplate(input);
    notifyRepositoryMutation(scope, { type: "template.created", template: result.template });
    return result;
  },
  async updateTemplate(templateId, input) {
    const result = await repository.updateTemplate(templateId, input);
    notifyRepositoryMutation(scope, { type: "template.updated", template: result.template });
    return result;
  },
  async deleteTemplate(templateId) {
    const result = await repository.deleteTemplate(templateId);
    notifyRepositoryMutation(scope, { type: "template.deleted", templateId });
    return result;
  },
  async mergeMemos(input) {
    const result = await repository.mergeMemos(input);
    notifyRepositoryMutation(scope, { type: "note.created", note: result.memo });
    return result;
  },
  async renameTag(previousName, name) {
    const result = await repository.renameTag(previousName, name);
    notifyRepositoryMutation(scope, { type: "tag.changed", previousName, name });
    return result;
  },
  async deleteTag(previousName) {
    const result = await repository.deleteTag(previousName);
    notifyRepositoryMutation(scope, { type: "tag.changed", previousName, deleted: true });
    return result;
  },
  async sync() {
    const result = await repository.sync();
    notifyRepositoryMutation(scope, { type: "workspace.synced", ...result });
    return result;
  },
});
