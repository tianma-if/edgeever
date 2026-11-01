import { expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useNoteImport } from "./use-note-import";

test("display labels update without replacing a task; account and instance changes replace it", async () => {
  const keys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  window.location = { origin: "http://import.test" };
  globalThis.window = window; globalThis.document = window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(window.document.getElementById("root"));
  let controller;
  const Probe = ({ id, label }) => { controller = useNoteImport(id, label, async () => {}); return null; };
  try {
    await act(async () => root.render(createElement(Probe, { id: "account-a", label: "Old name" })));
    const first = controller;
    await act(async () => root.render(createElement(Probe, { id: "account-a", label: "New name" })));
    expect(controller).toBe(first);
    expect(controller.accountLabel).toBe("New name");
    await act(async () => root.render(createElement(Probe, { id: "account-b", label: "New name" })));
    expect(controller).not.toBe(first);
    const second = controller;
    window.edgeeverDesktop = { isAvailable: true, apiBaseUrl: "http://other-instance.test" };
    await act(async () => root.render(createElement(Probe, { id: "account-b", label: "New name" })));
    expect(controller).not.toBe(second);
  } finally {
    await act(async () => root.unmount());
    keys.forEach((key, i) => previous[i] ? Object.defineProperty(globalThis, key, previous[i]) : delete globalThis[key]);
  }
});
