import { expect, jest, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { replaceAttachmentResource } from "./attachment-writeback.mjs";
import { uploadAttachmentSnapshot } from "./attachment-upload.mjs";

const bytes = Buffer.from("already committed");
const resource = { id: "res_1", sha256: createHash("sha256").update(bytes).digest("hex") };

for (const [status, expectedCode] of [[409, null], [404, "writeback_unsupported"], [403, "http_403"]]) {
  test(`writeback honors HTTP ${status} when the PUT response body is interrupted`, async () => {
    const calls = [];
    const request = async (path, init, _assertCurrent, progress) => {
      if (path.endsWith("capabilities")) return Response.json({ preserveFilename: true });
      calls.push(init.method);
      if (init.method === "GET") return new Response(bytes);
      const client = new EventEmitter();
      const message = new PassThrough();
      client.getUploadProgress = () => ({ current: 0 });
      client.abort = () => message.destroy();
      client.end = () => {
        message.statusCode = calls.length === 1 ? status : 200;
        message.headers = {};
        client.emit("response", message);
        if (message.statusCode === 200) return message.end(JSON.stringify({ resource }));
        message.write("{");
        setImmediate(() => message.destroy(new Error("Response body interrupted")));
      };
      return uploadAttachmentSnapshot({ request: () => client }, `http://localhost${path}`, init, progress);
    };
    const result = replaceAttachmentResource(request, {
      bytes, resourceId: resource.id, expectedContentHash: "old", filename: "budget.xls",
      mimeType: "application/vnd.ms-excel", assertCurrent() {},
    });
    if (expectedCode) {
      await expect(result).rejects.toMatchObject({ code: expectedCode, retryable: false });
      expect(calls).toEqual(["PUT"]);
    } else {
      expect(await result).toEqual(resource);
      expect(calls).toEqual(["PUT", "GET", "PUT"]);
    }
  });
}

test("a 403 whose body stalls keeps its non-retryable HTTP status", async () => {
  jest.useFakeTimers();
  try {
    const request = async (path, { signal }) => {
      if (path.endsWith("capabilities")) return Response.json({ preserveFilename: true });
      return new Response(new ReadableStream({
        pull() {
          jest.advanceTimersByTime(120_001);
          signal.throwIfAborted();
        },
      }, { highWaterMark: 0 }), { status: 403 });
    };
    await expect(replaceAttachmentResource(request, {
      bytes, resourceId: resource.id, expectedContentHash: "old", filename: "budget.xls",
      mimeType: "application/vnd.ms-excel", assertCurrent() {},
    })).rejects.toMatchObject({ code: "http_403", retryable: false });
  } finally { jest.useRealTimers(); }
});
