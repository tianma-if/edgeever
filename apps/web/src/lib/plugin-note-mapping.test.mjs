import { expect, test } from 'bun:test';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
const { localDb } = await import('./local-db');
const { api } = await import('./api');
const { createWebRepository } = await import('./repository');
const { createLocalMemo, replaceLocalMemoId } = await import('./local-mirror');
test('a plugin can reopen its saved temporary note ID after synchronization', async () => {
  const scope = `plugin-note-${crypto.randomUUID()}`;
  const savedGetMemo = api.getMemo;
  try {
    const local = await createLocalMemo(scope, { notebookId: 'nb_test', title: 'Research', contentMarkdown: '# Research' });
    const remote = { ...local, id: 'memo_synced_research' };
    await replaceLocalMemoId(scope, local.id, remote);
    const requested = [];
    api.getMemo = async id => { requested.push(id); if (id !== remote.id) throw new Error('Memo not found'); return { memo: remote }; };
    const reopened = await createWebRepository(scope).getMemo(local.id);
    expect(reopened.memo.id).toBe(remote.id); expect(requested).toEqual([remote.id]);
  } finally {
    api.getMemo = savedGetMemo;
    await localDb.memos.where('scope').equals(scope).delete();
    await localDb.idMappings.where('scope').equals(scope).delete();
  }
});
