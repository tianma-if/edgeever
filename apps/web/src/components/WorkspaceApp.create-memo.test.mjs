import { describe, expect, test } from "bun:test";
import { MutationObserver, QueryClient, onlineManager } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(new URL("./WorkspaceApp.tsx", import.meta.url), "utf8");
const notebookPaneSource = readFileSync(new URL("./NotebookPane.tsx", import.meta.url), "utf8");
const editorSource = readFileSync(new URL("./EditorPane.tsx", import.meta.url), "utf8");
const searchControllerSource = readFileSync(new URL("./editor/useEditorNoteSearchController.ts", import.meta.url), "utf8");
const queuedSyncSource = readFileSync(new URL("../hooks/useWorkspaceQueuedSync.ts", import.meta.url), "utf8");
const desktopSyncSource = readFileSync(new URL("../lib/desktop-sync.ts", import.meta.url), "utf8");

describe("desktop create-note wiring", () => {
  test("creates a notebook offline once and refreshes the local notebook list", async () => {
    const createOptions = workspaceSource.match(/const createNotebookMutation = useMutation\(\{([\s\S]*?)onSuccess:/)?.[1];
    const listOptions = notebookPaneSource.match(/const notebooksQuery = useQuery\(\{([\s\S]*?)\}\);/)?.[1];
    const mutationNetworkMode = createOptions?.match(/networkMode: "([^"]+)"/)?.[1];
    const queryNetworkMode = listOptions?.match(/networkMode: "([^"]+)"/)?.[1];
    const client = new QueryClient();
    const queryKey = ["notebooks"];
    const notebooks = [{ id: "parent" }];
    const notebook = { id: "child", parentId: "parent" };
    client.setQueryData(queryKey, { notebooks: [...notebooks] });
    let creates = 0;
    const mutation = new MutationObserver(client, {
      networkMode: mutationNetworkMode,
      mutationFn: async () => {
        creates += 1;
        notebooks.push(notebook);
      },
      onSuccess: () => client.fetchQuery({
        queryKey,
        networkMode: queryNetworkMode,
        queryFn: () => ({ notebooks: [...notebooks] }),
      }),
    });
    const wasOnline = onlineManager.isOnline();
    client.mount();
    try {
      onlineManager.setOnline(false);
      const result = mutation.mutate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(creates).toBe(1);
      expect(client.getQueryData(queryKey)?.notebooks).toEqual([{ id: "parent" }, notebook]);
      onlineManager.setOnline(true);
      await result;
      expect(creates).toBe(1);
    } finally {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      client.unmount();
      onlineManager.setOnline(wasOnline);
    }
  });

  test("ignores a second new-note request while the first create is still in flight", () => {
    expect(workspaceSource).toContain("createMemoInFlightRef");
    expect(workspaceSource).toContain("createMemoInFlightRef.current || createMemoMutation.isPending");
    expect(workspaceSource).toContain("createMemoInFlightRef.current = false");
  });

  test("remaps the memo list when a local create id becomes the durable id", () => {
    expect(queuedSyncSource).toContain("remapMemoIdsInLists(queryClient, memoIdMappings)");
    expect(queuedSyncSource).toContain("MEMO_ID_REMAPPED_EVENT");
  });

  test("remaps a newly selected notebook before creating notes in it", () => {
    expect(queuedSyncSource).toContain("setSelectedNotebookId((current) => current === temporaryId ? remoteId : current)");
    expect(queuedSyncSource).toContain("notifyNotebookIdRemapped(temporaryId, (result as Notebook).id)");
    expect(desktopSyncSource).toContain("notifyNotebookIdRemapped(item.entityId, result.id)");
    expect(workspaceSource.indexOf("setSelectedNotebookId(data.notebook.id)")).toBeLessThan(
      workspaceSource.indexOf("await queryClient.invalidateQueries({ queryKey: [\"notebooks\"] });")
    );
  });

  test("resets in-note search on editor instance changes, not local-to-remote id remaps", () => {
    expect(searchControllerSource).toContain("editorInstanceKey");
    expect(searchControllerSource).toContain("shouldResetNoteSearchForMemoChange(previousEditorInstanceKeyRef.current, editorInstanceKey)");
    expect(editorSource).toContain("editorInstanceKey: editorInstanceMemoKey");
  });

  test("reuses the TipTap view when switching memos and resets the document instead of remounting", () => {
    expect(editorSource).toContain("resetEditorDocument");
    expect(editorSource).toContain("switching notes now");
    expect(editorSource).toContain("also reuses it and resets undo history via resetEditorDocument");
    expect(editorSource).not.toContain("an actual memo switch still receives a fresh undo history.");
  });

  test("prefetches memo detail when a list card is pressed", () => {
    expect(workspaceSource).toContain("prefetchMemoDetail");
    expect(workspaceSource).toContain("onPrefetchMemo={prefetchMemoDetail}");
    expect(workspaceSource).toContain("queryClient.prefetchQuery");
  });

  test("evicts idle memo bodies when switching notes", () => {
    expect(workspaceSource).toContain("evictIdleMemoDetails(queryClient, detailMemoId)");
  });

  test("restores the last desktop memo after a renderer hibernate reload", () => {
    expect(workspaceSource).toContain("readDesktopWorkspaceRestoreState");
    expect(workspaceSource).toContain("writeDesktopWorkspaceRestoreState");
    expect(workspaceSource).toContain("useWorkspaceSelection(desktopWorkspaceRestore)");
    expect(editorSource).toContain("onHibernatePrepare");
  });

  test("keeps retrying create-note autofocus until the editor is editable and focused", () => {
    expect(editorSource).toContain("shouldRetryCreatedMemoFocus");
    expect(editorSource).toContain("isCreatedMemoEditorFocused");
    expect(editorSource).toContain("currentEditor.isEditable");
  });
});
