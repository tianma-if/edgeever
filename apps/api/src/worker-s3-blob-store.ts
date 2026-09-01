import { AwsClient } from "aws4fetch";
import type { BlobMultipartUploadAdapter, BlobObjectAdapter, BlobStoreAdapter } from "./storage-contract";

export type WorkerS3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  objectPrefix: string;
};

const encodePath = (value: string) => value.split("/").filter(Boolean).map(encodeURIComponent).join("/");

const fullObjectKey = (prefix: string, objectKey: string) =>
  [prefix.replace(/^\/+|\/+$/g, ""), objectKey.replace(/^\/+/, "")].filter(Boolean).join("/");

const createObjectUrl = (config: WorkerS3Config, objectKey: string) => {
  const url = new URL(config.endpoint);
  const encodedKey = encodePath(fullObjectKey(config.objectPrefix, objectKey));
  const endpointPath = url.pathname.replace(/\/$/, "");

  if (config.forcePathStyle) {
    url.pathname = `${endpointPath}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = `${endpointPath}/${encodedKey}`;
  }

  return url;
};

const responseError = async (operation: string, response: Response) => {
  const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
  return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
};

const totalSizeFromResponse = (response: Response) => {
  const match = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  return match ? Number(match[1]) : Number(response.headers.get("content-length") ?? 0);
};

const xmlText = (value: string, tag: string) => {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(value);
  return match?.[1]?.trim() ?? null;
};

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export const createWorkerS3BlobStore = (config: WorkerS3Config): BlobStoreAdapter => {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });

  const resumeMultipartUpload = (objectKey: string, uploadId: string): BlobMultipartUploadAdapter => ({
    uploadId,
    async uploadPart(partNumber, value) {
      const url = createObjectUrl(config, objectKey);
      url.searchParams.set("partNumber", String(partNumber));
      url.searchParams.set("uploadId", uploadId);
      const response = await client.fetch(url.toString(), { method: "PUT", body: value as BodyInit });
      if (!response.ok) throw await responseError("Multipart part upload", response);
      const etag = response.headers.get("etag");
      if (!etag) throw new Error("Multipart upload part did not return an ETag.");
      return { partNumber, etag };
    },
    async complete(parts) {
      const url = createObjectUrl(config, objectKey);
      url.searchParams.set("uploadId", uploadId);
      const body = `<CompleteMultipartUpload>${parts
        .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`)
        .join("")}</CompleteMultipartUpload>`;
      const response = await client.fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body,
      });
      if (!response.ok) throw await responseError("Multipart upload completion", response);
      const result = await response.text();
      if (/<Error(?:\s|>)/.test(result)) {
        throw new Error(`Multipart upload completion failed: ${result.replace(/\s+/g, " ").trim().slice(0, 300)}`);
      }
    },
    async abort() {
      const url = createObjectUrl(config, objectKey);
      url.searchParams.set("uploadId", uploadId);
      const response = await client.fetch(url.toString(), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw await responseError("Multipart upload abort", response);
    },
  });

  return {
    async get(objectKey, options): Promise<BlobObjectAdapter | null> {
      const headers = new Headers();
      const range = options?.range;
      if (range) headers.set("range", `bytes=${range.offset}-${range.offset + range.length - 1}`);
      const response = await client.fetch(createObjectUrl(config, objectKey).toString(), { headers });
      if (response.status === 404) return null;
      if (!response.ok) throw await responseError("Object download", response);
      if (!response.body) throw new Error("Object download returned an empty body.");

      return {
        body: response.body,
        size: totalSizeFromResponse(response),
        range: range
          ? { offset: range.offset, length: Number(response.headers.get("content-length") ?? range.length) }
          : undefined,
        writeHttpMetadata: (headers) => {
          for (const name of ["content-type", "cache-control", "content-disposition", "etag", "last-modified"]) {
            const value = response.headers.get(name);
            if (value) headers.set(name, value);
          }
        },
      };
    },

    async put(objectKey, value, options) {
      const metadata = options as { httpMetadata?: Record<string, string> } | undefined;
      const httpMetadata = metadata?.httpMetadata ?? {};
      const headers = new Headers();
      if (httpMetadata.contentType) headers.set("content-type", httpMetadata.contentType);
      if (httpMetadata.cacheControl) headers.set("cache-control", httpMetadata.cacheControl);
      if (httpMetadata.contentDisposition) headers.set("content-disposition", httpMetadata.contentDisposition);
      const response = await client.fetch(createObjectUrl(config, objectKey).toString(), {
        method: "PUT",
        headers,
        body: value as BodyInit,
      });
      if (!response.ok) throw await responseError("Object upload", response);
    },

    async createMultipartUpload(objectKey, options) {
      const metadata = options as { httpMetadata?: Record<string, string> } | undefined;
      const httpMetadata = metadata?.httpMetadata ?? {};
      const headers = new Headers();
      if (httpMetadata.contentType) headers.set("content-type", httpMetadata.contentType);
      if (httpMetadata.cacheControl) headers.set("cache-control", httpMetadata.cacheControl);
      if (httpMetadata.contentDisposition) headers.set("content-disposition", httpMetadata.contentDisposition);
      const url = createObjectUrl(config, objectKey);
      url.searchParams.set("uploads", "");
      const response = await client.fetch(url.toString(), { method: "POST", headers });
      if (!response.ok) throw await responseError("Multipart upload initialization", response);
      const uploadId = xmlText(await response.text(), "UploadId");
      if (!uploadId) throw new Error("Multipart upload initialization did not return an upload ID.");
      return resumeMultipartUpload(objectKey, uploadId);
    },

    resumeMultipartUpload,

    async delete(objectKeys) {
      for (const objectKey of Array.isArray(objectKeys) ? objectKeys : [objectKeys]) {
        const response = await client.fetch(createObjectUrl(config, objectKey).toString(), { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw await responseError("Object deletion", response);
      }
    },
  };
};

export const testWorkerS3Connection = async (config: WorkerS3Config) => {
  const store = createWorkerS3BlobStore(config);
  const objectKey = `.edgeever-connection-test/${crypto.randomUUID()}.txt`;
  const expected = `EdgeEver object storage test ${new Date().toISOString()}`;
  await store.put(objectKey, new TextEncoder().encode(expected), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  try {
    const object = await store.get(objectKey);
    if (!object) throw new Error("The test object could not be read after upload.");
    const actual = await new Response(object.body).text();
    if (actual !== expected) throw new Error("The test object content did not match after upload.");
  } finally {
    await store.delete(objectKey);
  }
};
