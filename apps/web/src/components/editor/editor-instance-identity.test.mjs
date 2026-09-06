import { describe, expect, test } from "bun:test";
import {
  createEditorInstanceMemoIdentity,
  isEditorInstanceHydratedForMemo,
  reconcileEditorInstanceMemoIdentity,
  remapEditorInstanceMemoIdentity,
} from "./editor-instance-identity.ts";

describe("editor instance memo identity", () => {
  test("keeps the editor instance when a created memo receives its durable id", () => {
    const localIdentity = createEditorInstanceMemoIdentity("local_memo_1");
    const remappedIdentity = remapEditorInstanceMemoIdentity(
      localIdentity,
      new Map([["local_memo_1", "memo_remote_1"]]),
    );
    const identityDuringParentRerender = reconcileEditorInstanceMemoIdentity(
      remappedIdentity,
      "local_memo_1",
    );
    const reconciledIdentity = reconcileEditorInstanceMemoIdentity(
      identityDuringParentRerender,
      "memo_remote_1",
    );

    expect(reconciledIdentity.memoId).toBe("memo_remote_1");
    expect(reconciledIdentity.instanceKey).toBe(localIdentity.instanceKey);
    expect(reconciledIdentity).toBe(remappedIdentity);
  });

  test("changes the editor instance when the selected memo really changes", () => {
    const firstIdentity = createEditorInstanceMemoIdentity("memo_1");
    const secondIdentity = reconcileEditorInstanceMemoIdentity(firstIdentity, "memo_2");

    expect(secondIdentity).toMatchObject({ memoId: "memo_2", instanceKey: "memo_2" });
    expect(secondIdentity.aliases).toEqual(new Set(["memo_2"]));
    expect(secondIdentity.instanceKey).not.toBe(firstIdentity.instanceKey);
  });

  test("keeps the editor hydrated while desktop sync announces the durable id before the parent rerenders", () => {
    const localIdentity = createEditorInstanceMemoIdentity("local_memo_1");
    const remappedIdentity = remapEditorInstanceMemoIdentity(
      localIdentity,
      new Map([["local_memo_1", "memo_remote_1"]]),
    );

    expect(isEditorInstanceHydratedForMemo(
      remappedIdentity,
      "memo_remote_1",
      "local_memo_1",
    )).toBe(true);
    expect(isEditorInstanceHydratedForMemo(
      remappedIdentity,
      "memo_remote_1",
      "memo_remote_1",
    )).toBe(true);
  });

  test("does not treat a genuinely different memo as hydrated", () => {
    const identity = createEditorInstanceMemoIdentity("memo_1");

    expect(isEditorInstanceHydratedForMemo(identity, "memo_1", "memo_2")).toBe(false);
  });

  test("ignores id mappings for a different memo", () => {
    const identity = createEditorInstanceMemoIdentity("memo_1");

    expect(remapEditorInstanceMemoIdentity(
      identity,
      new Map([["local_memo_2", "memo_remote_2"]]),
    )).toBe(identity);
  });
});
