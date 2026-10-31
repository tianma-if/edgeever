import { beforeEach, describe, expect, test } from "bun:test";
import { SandboxRequestError, createSandboxBridge } from "./bridge.ts";

const createFakeTransport = () => {
  let listener = null;
  const sent = [];
  return {
    sent,
    transport: {
      post(message) {
        sent.push(message);
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    receive(message) {
      listener?.(message);
    },
  };
};

describe("sandbox bridge", () => {
  let fake;
  let bridge;

  beforeEach(() => {
    fake = createFakeTransport();
    bridge = createSandboxBridge(fake.transport, { timeoutMs: 50 });
  });

  test("resolves requests with host responses", async () => {
    const pending = bridge.request("notes.get", { noteId: "memo_1" });
    const request = fake.sent.at(-1);
    expect(request).toMatchObject({ type: "request", method: "notes.get", params: { noteId: "memo_1" } });
    fake.receive({ v: 1, type: "response", id: request.id, ok: true, result: { id: "memo_1" } });
    await expect(pending).resolves.toEqual({ id: "memo_1" });
  });

  test("rejects with host error payloads", async () => {
    const pending = bridge.request("notes.get", { noteId: "missing" });
    const request = fake.sent.at(-1);
    fake.receive({ v: 1, type: "response", id: request.id, ok: false, error: { message: "not found", code: "NOTE_CONFLICT" } });
    const error = await pending.catch((value) => value);
    expect(error).toBeInstanceOf(SandboxRequestError);
    expect(error.message).toBe("not found");
    expect(error.code).toBe("NOTE_CONFLICT");
  });

  test("times out unanswered requests", async () => {
    await expect(bridge.request("notes.get", { noteId: "slow" })).rejects.toThrow("timed out");
  });

  test("answers host queries and reports unknown queries", async () => {
    const dispose = bridge.handle("panel.beforeClose", async () => ({ title: "确认关闭？", message: "有未保存的修改" }));
    fake.receive({ v: 1, type: "request", id: 7, method: "panel.beforeClose" });
    await Bun.sleep(0);
    expect(fake.sent.at(-1)).toMatchObject({ type: "query-result", id: 7, ok: true, result: { title: "确认关闭？" } });
    dispose();
    fake.receive({ v: 1, type: "request", id: 8, method: "panel.beforeClose" });
    await Bun.sleep(0);
    expect(fake.sent.at(-1)).toMatchObject({ type: "query-result", id: 8, ok: false });
  });

  test("dispatches notifications and ignores unknown protocol versions", () => {
    const received = [];
    bridge.subscribe((message) => received.push(message));
    fake.receive({ v: 1, type: "notice", message: "hi" });
    fake.receive({ v: 99, type: "notice", message: "ignored" });
    expect(received).toEqual([{ v: 1, type: "notice", message: "hi" }]);
  });

  test("rejects pending requests after dispose", async () => {
    const pending = bridge.request("notes.get", { noteId: "x" });
    bridge.dispose();
    await expect(pending).rejects.toThrow("disposed");
  });
});
