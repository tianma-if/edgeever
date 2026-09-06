import { afterEach, describe, expect, test } from "bun:test";
import { createWorkerS3BlobStore, testWorkerS3Connection } from "./worker-s3-blob-store.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Worker S3-compatible blob store", () => {
  test("signs and verifies a path-style upload/read/delete probe", async () => {
    const objects = new Map();
    const requests = [];
    globalThis.fetch = async (request) => {
      requests.push(request);
      expect(request.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
      if (request.method === "PUT") {
        objects.set(request.url, new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 200 });
      }
      if (request.method === "GET") {
        const value = objects.get(request.url);
        return value ? new Response(value, { status: 200 }) : new Response(null, { status: 404 });
      }
      if (request.method === "DELETE") {
        objects.delete(request.url);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };

    await testWorkerS3Connection({
      endpoint: "https://objects.example.com",
      region: "us-east-1",
      bucket: "edgeever",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      forcePathStyle: true,
      objectPrefix: "notes",
    });

    expect(requests.map((request) => request.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect(new URL(requests[0].url).pathname).toStartWith("/edgeever/notes/.edgeever-connection-test/");
    expect(objects.size).toBe(0);
  });

  test("forwards byte ranges and preserves the total object size", async () => {
    let observedRange = null;
    globalThis.fetch = async (request) => {
      observedRange = request.headers.get("range");
      return new Response("2345", {
        status: 206,
        headers: {
          "Content-Length": "4",
          "Content-Range": "bytes 2-5/10",
        },
      });
    };
    const store = createWorkerS3BlobStore({
      endpoint: "https://objects.example.com",
      region: "us-east-1",
      bucket: "edgeever",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      forcePathStyle: true,
      objectPrefix: "notes",
    });

    const object = await store.get("report.pdf", { range: { offset: 2, length: 4 } });

    expect(observedRange).toBe("bytes=2-5");
    expect(object?.size).toBe(10);
    expect(object?.range).toEqual({ offset: 2, length: 4 });
    expect(await new Response(object?.body).text()).toBe("2345");
  });

  test("signs the complete multipart lifecycle", async () => {
    const requests = [];
    globalThis.fetch = async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "POST" && url.searchParams.has("uploads")) {
        return new Response("<InitiateMultipartUploadResult><UploadId>provider-1</UploadId></InitiateMultipartUploadResult>");
      }
      if (request.method === "PUT") return new Response(null, { headers: { etag: '"part-1"' } });
      if (request.method === "POST" && url.searchParams.get("uploadId") === "provider-1") {
        expect(await request.text()).toContain("<PartNumber>1</PartNumber>");
        return new Response("<CompleteMultipartUploadResult />");
      }
      return new Response(null, { status: 405 });
    };
    const store = createWorkerS3BlobStore({
      endpoint: "https://objects.example.com",
      region: "us-east-1",
      bucket: "edgeever",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      forcePathStyle: true,
      objectPrefix: "notes",
    });

    const upload = await store.createMultipartUpload("archive.bin");
    const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
    await upload.complete([part]);

    expect(upload.uploadId).toBe("provider-1");
    expect(requests.map((request) => request.method)).toEqual(["POST", "PUT", "POST"]);
  });
});
