import type { MutableRefObject } from "react";
import type { LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { safeDomCall } from "./safe-dom-call";

type EditorRef = MutableRefObject<LocalTiptapEditorRef | null>;
type FlushResolverRef = MutableRefObject<(() => void) | null>;

export const flushMobileEditor = async (
  editorRef: EditorRef,
  resolverRef: FlushResolverRef,
  timeoutMs = 1000,
) => {
  if (!editorRef.current) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      resolverRef.current = null;
      resolve();
    };

    resolverRef.current = finish;
    safeDomCall(() => editorRef.current?.flush());
    timeout = setTimeout(finish, timeoutMs);
  });
};

type UploadedEditorResource = {
  kind: string;
  url: string;
  filename?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
};

export const applyMobileEditorUpload = (
  editorRef: EditorRef,
  resource: UploadedEditorResource,
  uploadId: string | null,
  fallbackFilename: string,
) => {
  const filename = resource.filename || fallbackFilename;
  if (resource.kind === "image" && uploadId) {
    safeDomCall(() => editorRef.current?.completeImageUpload(uploadId, resource.url, filename));
    return;
  }
  safeDomCall(() => editorRef.current?.appendAttachment(
    resource.url,
    filename,
    resource.mimeType || "",
    resource.byteSize || 0,
  ));
};

export const cancelMobileEditorUpload = (editorRef: EditorRef, uploadId: string | null) => {
  if (!uploadId) return;
  safeDomCall(() => editorRef.current?.cancelImageUpload(uploadId));
};
