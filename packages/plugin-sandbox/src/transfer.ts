/**
 * Wire helpers for values that JSON cannot represent directly (bytes, headers,
 * multipart bodies, `Response`). Kept separate from the bridge so both the
 * sandbox runtime and its unit tests can use them without a DOM.
 */

export type SerializedBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "base64"; data: string; mimeType?: string }
  | { kind: "form-data"; parts: SerializedFormDataPart[] };

export type SerializedFormDataPart =
  | { name: string; value: string; filename?: string }
  | { name: string; dataBase64: string; filename: string; mimeType: string };

export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  url?: string;
  body?: { kind: "text"; text: string } | { kind: "base64"; data: string };
}

export interface SerializedBlob {
  mimeType: string;
  dataBase64: string;
}

const BASE64_CHUNK = 0x8000;

/** Copy into a plain ArrayBuffer so values satisfy DOM `BlobPart`/`BodyInit` types. */
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const headersToEntries = (headers?: HeadersInit): Array<[string, string]> => {
  if (!headers) return [];
  const result: Array<[string, string]> = [];
  new Headers(headers).forEach((value, name) => result.push([name, value]));
  return result;
};

export const entriesToHeaders = (entries: Array<[string, string]> | undefined): Headers => {
  const headers = new Headers();
  for (const [name, value] of entries ?? []) headers.append(name, value);
  return headers;
};

const isBlob = (value: unknown): value is Blob =>
  typeof Blob !== "undefined" && value instanceof Blob;

const blobToBase64 = async (blob: Blob): Promise<string> =>
  bytesToBase64(new Uint8Array(await blob.arrayBuffer()));

/** Convert a fetch body into a JSON-safe payload. Streams are not supported. */
export const serializeBody = async (body: BodyInit | null | undefined): Promise<SerializedBody> => {
  if (body === null || body === undefined) return { kind: "none" };
  if (typeof body === "string") return { kind: "text", text: body };
  if (body instanceof URLSearchParams) return { kind: "text", text: body.toString() };
  if (isBlob(body)) return { kind: "base64", data: await blobToBase64(body), mimeType: body.type || undefined };
  if (body instanceof ArrayBuffer) return { kind: "base64", data: bytesToBase64(new Uint8Array(body)) };
  if (ArrayBuffer.isView(body)) {
    return { kind: "base64", data: bytesToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)) };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: SerializedFormDataPart[] = [];
    for (const [name, value] of body.entries()) {
      if (typeof value === "string") {
        parts.push({ name, value });
      } else {
        const filename = typeof File !== "undefined" && value instanceof File ? value.name : name;
        parts.push({
          name,
          dataBase64: await blobToBase64(value),
          filename,
          mimeType: value.type || "application/octet-stream",
        });
      }
    }
    return { kind: "form-data", parts };
  }
  throw new Error("Plugin network requests only support string, URLSearchParams, Blob, ArrayBuffer and FormData bodies.");
};

/** Host-side counterpart of {@link serializeBody}: rebuild a `BodyInit`. */
export const deserializeBody = (body: SerializedBody | undefined): BodyInit | undefined => {
  if (!body || body.kind === "none") return undefined;
  if (body.kind === "text") return body.text;
  if (body.kind === "base64") {
    const bytes = base64ToBytes(body.data);
    return body.mimeType ? new Blob([toArrayBuffer(bytes)], { type: body.mimeType }) : toArrayBuffer(bytes);
  }
  const form = new FormData();
  for (const part of body.parts) {
    if ("value" in part) {
      form.append(part.name, part.value);
    } else {
      const bytes = base64ToBytes(part.dataBase64);
      form.append(part.name, new Blob([toArrayBuffer(bytes)], { type: part.mimeType }), part.filename);
    }
  }
  return form;
};

export const serializeResponse = async (response: Response): Promise<SerializedResponse> => {
  const headers = headersToEntries(response.headers);
  const result: SerializedResponse = {
    status: response.status,
    statusText: response.statusText,
    headers,
    url: response.url,
  };
  if (response.status === 204 || response.status === 205 || response.status === 304) return result;
  const buffer = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const isText = /^text\/|json|xml|javascript|x-www-form-urlencoded/i.test(contentType);
  if (isText) {
    result.body = { kind: "text", text: new TextDecoder().decode(buffer) };
  } else {
    result.body = { kind: "base64", data: bytesToBase64(buffer) };
  }
  return result;
};

export const deserializeResponse = (payload: SerializedResponse): Response => {
  const body = payload.body
    ? payload.body.kind === "text" ? payload.body.text : toArrayBuffer(base64ToBytes(payload.body.data))
    : null;
  const response = new Response(body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: entriesToHeaders(payload.headers),
  });
  if (payload.url) Object.defineProperty(response, "url", { value: payload.url });
  return response;
};

export const serializeBlob = async (blob: Blob): Promise<SerializedBlob> => ({
  mimeType: blob.type || "application/octet-stream",
  dataBase64: await blobToBase64(blob),
});

export const deserializeBlob = (payload: SerializedBlob): Blob =>
  new Blob([toArrayBuffer(base64ToBytes(payload.dataBase64))], { type: payload.mimeType });
