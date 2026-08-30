import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { BlobStoreAdapter, BlobObjectAdapter, StorageAdapter } from "./storage-contract";
import type { SqliteDatabaseLike } from "./self-hosted-storage-adapter";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter";

export type S3CompatibleStorageConfig = {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

type S3Body = {
  transformToWebStream?: () => ReadableStream<Uint8Array>;
  transformToByteArray?: () => Promise<Uint8Array>;
};

const toWebStream = async (body: unknown): Promise<ReadableStream<Uint8Array>> => {
  const candidate = body as S3Body | ReadableStream<Uint8Array> | Readable | Blob | Uint8Array;

  if (candidate && typeof (candidate as S3Body).transformToWebStream === "function") {
    return (candidate as S3Body).transformToWebStream!();
  }

  if (candidate instanceof ReadableStream) {
    return candidate;
  }

  if (candidate instanceof Blob) {
    return candidate.stream() as ReadableStream<Uint8Array>;
  }

  if (candidate instanceof Uint8Array) {
    return new Blob([candidate as never]).stream() as ReadableStream<Uint8Array>;
  }

  if (candidate && typeof (candidate as S3Body).transformToByteArray === "function") {
    return new Blob([await (candidate as S3Body).transformToByteArray!() as never]).stream() as ReadableStream<Uint8Array>;
  }

  return new Response(candidate as BodyInit).body as ReadableStream<Uint8Array>;
};

const isMissingObjectError = (error: unknown) => {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NoSuchKey"
    || candidate.name === "NotFound"
    || candidate.$metadata?.httpStatusCode === 404;
};

const totalSizeFromContentRange = (contentRange: string | undefined) => {
  const match = /\/(\d+)$/.exec(contentRange ?? "");
  return match ? Number(match[1]) : null;
};

const createS3BlobStore = (
  config: S3CompatibleStorageConfig,
  client = new S3Client({
    region: config.region ?? "us-east-1",
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    credentials: config.accessKeyId && config.secretAccessKey
      ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
      : undefined,
  }),
): BlobStoreAdapter => ({
  async get(objectKey, options): Promise<BlobObjectAdapter | null> {
    try {
      const range = options?.range;
      const result = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Range: range ? `bytes=${range.offset}-${range.offset + range.length - 1}` : undefined,
      }));
      if (!result.Body) {
        return null;
      }

      const body = await toWebStream(result.Body);
      return {
        body,
        size: totalSizeFromContentRange(result.ContentRange) ?? result.ContentLength ?? 0,
        range: range ? { offset: range.offset, length: result.ContentLength ?? range.length } : undefined,
        writeHttpMetadata: (headers) => {
          if (result.ContentType) headers.set("Content-Type", result.ContentType);
          if (result.CacheControl) headers.set("Cache-Control", result.CacheControl);
          if (result.ContentDisposition) headers.set("Content-Disposition", result.ContentDisposition);
          if (result.ETag) headers.set("ETag", result.ETag);
          if (result.LastModified) headers.set("Last-Modified", result.LastModified.toUTCString());
        },
      };
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  },

  async put(objectKey, value, options) {
    const metadata = options as { httpMetadata?: Record<string, string> } | undefined;
    const httpMetadata = metadata?.httpMetadata ?? {};
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: value as never,
      ContentType: httpMetadata.contentType,
      CacheControl: httpMetadata.cacheControl,
      ContentDisposition: httpMetadata.contentDisposition,
    }));
  },

  async delete(objectKeys) {
    const keys = Array.isArray(objectKeys) ? objectKeys : [objectKeys];
    for (let index = 0; index < keys.length; index += 1000) {
      await client.send(new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) },
      }));
    }
  },
});

/**
 * S3-compatible storage for self-hosted deployments. The SQLite adapter is
 * reused for metadata while objects are stored in S3/MinIO/OSS/COS/R2.
 */
export const createS3CompatibleStorageAdapter = (
  sqlite: SqliteDatabaseLike,
  config: S3CompatibleStorageConfig,
  client?: S3Client,
): StorageAdapter => {
  const selfHosted = createSelfHostedStorageAdapter(sqlite, ".edgeever-unused-resources");
  return {
    db: selfHosted.db,
    resources: createS3BlobStore(config, client),
    diagnostics: {
      ...selfHosted.diagnostics,
      resources: "s3",
    },
  };
};
