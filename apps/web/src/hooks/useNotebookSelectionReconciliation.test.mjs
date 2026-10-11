import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useWorkspaceSelection } from "./useWorkspaceSelection.ts";
import { useNotebookSelectionReconciliation } from "./useNotebookSelectionReconciliation.ts";

const globals = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let root;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

const mount = async (initialNotebookId = "test") => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(window.document.getElementById("root"));
  let selection;
  const Harness = ({ notebooks }) => {
    selection = useWorkspaceSelection({ selectedNotebookId: initialNotebookId, selectedMemoId: "memo" });
    useNotebookSelectionReconciliation({ notebooks, ...selection });
    return createElement("div", null, selection.selectedNotebookId ?? "all");
  };
  const render = async (notebooks) => {
    await act(async () => root.render(createElement(Harness, { notebooks })));
    return selection;
  };
  return { render, selection: () => selection, text: () => window.document.body.textContent };
};

test("external deletion returns to all notes and clears stale single and bulk selections", async () => {
  const h = await mount();
  await h.render([{ id: "test" }, { id: "inbox" }]);
  await act(async () => h.selection().replaceMemoSelection(["memo"]));
  await h.render([{ id: "inbox" }]);
  expect(h.text()).toBe("all");
  expect(h.selection().selectedMemoId).toBeNull();
  expect(h.selection().selectedMemoIds.size).toBe(0);
  expect(h.selection().memoSelectionMode).toBe(false);
});

test("loading or an unsettled catalog preserves selection, including newly created notebooks", async () => {
  const h = await mount();
  await h.render(undefined);
  expect(h.selection().selectedNotebookId).toBe("test");
  await h.render([{ id: "test" }]);
  await h.render(undefined);
  await act(async () => h.selection().setSelectedNotebookId("new"));
  expect(h.selection().selectedNotebookId).toBe("new");
  await h.render([{ id: "test" }, { id: "new" }]);
  expect(h.selection().selectedNotebookId).toBe("new");
});

test("deleting another notebook preserves current selection", async () => {
  const h = await mount();
  await h.render([{ id: "test" }, { id: "other" }]);
  await h.render([{ id: "test" }]);
  expect(h.selection().selectedNotebookId).toBe("test");
  expect(h.selection().selectedMemoId).toBe("memo");
});

test("a settled empty catalog clears a restored missing notebook", async () => {
  const h = await mount();
  await h.render(undefined);
  await h.render([]);
  expect(h.selection().selectedNotebookId).toBeNull();
});
