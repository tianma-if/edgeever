import { expect, test } from "bun:test";
import { registerAttachmentWritebackIpc } from "./attachment-writeback-ipc.mjs";

test("writeback IPC authorizes every operation and reveals only manager-owned paths", async () => {
  const handlers = new Map(); const calls = [];
  let allowed = false;
  registerAttachmentWritebackIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
    authorize: () => { if (!allowed) throw new Error("Forbidden"); }, getScope: () => "account-a",
    reveal: path => calls.push(path),
    manager: {
      list: async () => [{ id: "open-1" }],
      retry: async id => calls.push(id), tick: async () => {},
      filePath: async id => id === "open-1" ? "/account/open-1/file.txt" : null,
    },
  });
  for (const handler of handlers.values()) await expect(handler({}, "open-1")).rejects.toThrow("Forbidden");
  expect(calls).toEqual([]);
  allowed = true;
  expect(await handlers.get("desktop:attachment-writebacks")({})).toEqual([{ id: "open-1" }]);
  await handlers.get("desktop:reveal-attachment-writeback")({}, "../../private"); expect(calls).toEqual([]);
  await handlers.get("desktop:reveal-attachment-writeback")({}, "open-1");
  await handlers.get("desktop:retry-attachment-writeback")({}, "open-1");
  expect(calls).toEqual(["/account/open-1/file.txt", "open-1"]);
});

test("writeback IPC rechecks the sender and account after asynchronous manager work", async () => {
  for (const change of ["sender", "account"]) {
    for (const channel of ["desktop:attachment-writebacks", "desktop:retry-attachment-writeback", "desktop:reveal-attachment-writeback"]) {
      const handlers = new Map(); let allowed = true; let scope = "account-a";
      const calls = [];
      const changed = async value => { if (change === "sender") allowed = false; else scope = "account-b"; return value; };
      registerAttachmentWritebackIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
        authorize: () => { if (!allowed) throw new Error("Forbidden"); }, getScope: () => scope,
        reveal: path => calls.push(path),
        manager: {
          list: () => changed([{ id: "open-a" }]), retry: () => changed(), tick: async () => calls.push("tick"),
          filePath: () => changed("/account-a/open-a/file.txt"),
        },
      });
      await expect(handlers.get(channel)({}, "open-a")).rejects.toThrow();
      expect(calls).toEqual([]);
    }
  }
});
