import type { JsonBackupMemo, Resource } from "@edgeever/shared";
import { ApiRequestError, isAbsoluteHttpUrl, type createRequestTransport } from "./request-transport";

export const MAX_SINGLE_REQUEST_UPLOAD_BYTES = 5 * 1024 * 1024;

export type MultipartResourceUploadSource = {
  filename: string;
  mimeType: string;
  byteSize: number;
  readPart: (start: number, end: number) => Promise<Blob | Uint8Array<ArrayBuffer>>;
  /** Importers use this to distinguish an uncertain commit from a failed part. */
  onBeforeComplete?: () => void | Promise<void>;
  onPartUploaded?: (byteSize: number) => void;
};

export type ResourceResponse = {
  resource: Resource;
};

export type ResourceUploadResponse = {
  upload: {
    id: string;
    resourceId: string;
    partSize: number;
    partCount: number;
    byteSize: number;
    expiresAt: string;
  };
};

export const createResourceTransfer = ({ send, request, throwRequestError }: ReturnType<typeof createRequestTransport>) => {
  const requestResourceResponse = async (path: string, init?: RequestInit) => {
    const isAbsolute = isAbsoluteHttpUrl(path);
    const { context, response } = await send(path, init, {
      attachToken: !isAbsolute,
      setJsonContentType: false,
    });
    if (!response.ok) await throwRequestError(context, response, "Resource download failed");
    return response;
  };

  const requestBlob = async (path: string) => (await requestResourceResponse(path)).blob();

  const uploadMemoResourceParts = async (memoId: string, source: MultipartResourceUploadSource) => {
    const filename = source.filename.trim() || "attachment";
    const mimeType = source.mimeType || "application/octet-stream";
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/memos/${encodeURIComponent(memoId)}/resource-uploads`,
      {
        method: "POST",
        body: JSON.stringify({ filename, mimeType, byteSize: source.byteSize }),
      },
    );

    try {
      for (let partNumber = 1; partNumber <= upload.partCount; partNumber += 1) {
        const start = (partNumber - 1) * upload.partSize;
        const chunk = await source.readPart(start, Math.min(start + upload.partSize, source.byteSize));
        let attempt = 0;
        while (true) {
          try {
            await request<{ part: { partNumber: number; byteSize: number } }>(
              `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${partNumber}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: chunk,
              },
            );
            source.onPartUploaded?.(Math.min(partNumber * upload.partSize, source.byteSize));
            break;
          } catch (error) {
            attempt += 1;
            const retryable = !(error instanceof ApiRequestError)
              || error.status === 408
              || error.status === 429
              || error.status >= 500;
            if (!retryable || attempt >= 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 250));
          }
        }
      }
      await source.onBeforeComplete?.();
      return await request<ResourceResponse>(
        `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
        { method: "POST", body: JSON.stringify({}) },
      );
    } catch (error) {
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  };

  const uploadMemoResourceMultipart = (memoId: string, file: Blob) =>
    uploadMemoResourceParts(memoId, {
      filename: "name" in file && typeof file.name === "string" && file.name.trim()
        ? file.name
        : "attachment",
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      readPart: async (start, end) => file.slice(start, end),
    });

  const createResourceMultipartSink = (upload: ResourceUploadResponse["upload"]) => {
    let partNumber = 1;
    let bufferedBytes = 0;
    let receivedBytes = 0;
    let chunks: ArrayBuffer[] = [];
    let closed = false;

    const abort = async () => {
      if (closed) return;
      closed = true;
      chunks = [];
      bufferedBytes = 0;
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    };

    const sendPart = async () => {
      if (bufferedBytes === 0) return;
      const body = new Blob(chunks, { type: "application/octet-stream" });
      const currentPart = partNumber;
      chunks = [];
      bufferedBytes = 0;
      let attempt = 0;
      while (true) {
        try {
          await request<{ part: { partNumber: number; byteSize: number } }>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${currentPart}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body,
            },
          );
          partNumber += 1;
          return;
        } catch (error) {
          attempt += 1;
          const retryable = !(error instanceof ApiRequestError)
            || error.status === 408
            || error.status === 429
            || error.status >= 500;
          if (!retryable || attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    };

    return {
      write: async (chunk: Uint8Array) => {
        if (closed) throw new Error("Resource restore upload is closed");
        let offset = 0;
        while (offset < chunk.byteLength) {
          const available = upload.partSize - bufferedBytes;
          const length = Math.min(available, chunk.byteLength - offset);
          const copy = new Uint8Array(length);
          copy.set(chunk.subarray(offset, offset + length));
          chunks.push(copy.buffer);
          bufferedBytes += length;
          receivedBytes += length;
          offset += length;
          if (bufferedBytes === upload.partSize) await sendPart();
        }
      },
      close: async () => {
        if (closed) throw new Error("Resource restore upload is closed");
        if (receivedBytes !== upload.byteSize) {
          await abort();
          throw new Error(`Resource restore size mismatch: expected ${upload.byteSize}, received ${receivedBytes}`);
        }
        try {
          await sendPart();
          const result = await request<ResourceResponse>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
            { method: "POST", body: JSON.stringify({}) },
          );
          closed = true;
          return result;
        } catch (error) {
          await abort();
          throw error;
        }
      },
      abort,
    };
  };

  const createJsonResourceRestoreSink = async (
    resourceId: string,
    metadata: JsonBackupMemo["resources"][number],
  ) => {
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/restores/json/resources/${encodeURIComponent(resourceId)}/uploads`,
      { method: "POST", body: JSON.stringify(metadata) },
    );
    return createResourceMultipartSink(upload);
  };

  return {
    createJsonResourceRestoreSink,
    uploadMemoResourceParts,
    getResourceResponse: requestResourceResponse,
    getResourceBlob: requestBlob,
    restoreJsonResource: async (resourceId: string, metadata: JsonBackupMemo["resources"][number], file: Blob) => {
      const sink = await createJsonResourceRestoreSink(resourceId, metadata);
      const reader = file.stream().getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          await sink.write(next.value);
        }
        await sink.close();
        return { ok: true as const };
      } catch (error) {
        await sink.abort();
        throw error;
      } finally {
        reader.releaseLock();
      }
    },

    uploadMemoResource: (memoId: string, file: Blob | FormData) => {
      // Small files do not benefit from an upload session's three round trips.
      // Keep large attachments on the bounded-memory, resumable path.
      if (!(file instanceof FormData) && file.size > MAX_SINGLE_REQUEST_UPLOAD_BYTES) {
        return uploadMemoResourceMultipart(memoId, file);
      }
      const form = file instanceof FormData ? file : new FormData();
      if (!(file instanceof FormData)) {
        const filename = "name" in file && typeof file.name === "string" && file.name.trim()
          ? file.name
          : "attachment";
        form.append("file", file, filename);
      }
      return request<ResourceResponse>(`/api/v1/memos/${encodeURIComponent(memoId)}/resources`, {
        method: "POST",
        body: form,
      });
    },

    updateResourceContent: (resourceId: string, file: Blob, expectedContentHash: string) => {
      const form = new FormData();
      form.append("file", file);
      form.append("expectedContentHash", expectedContentHash);
      form.append("mimeType", file.type || "application/octet-stream");
      if (file instanceof File) form.append("filename", file.name);
      return request<ResourceResponse>(`/api/v1/resources/${encodeURIComponent(resourceId)}/blob`, {
        method: "PUT",
        body: form,
      });
    },
  };
};
