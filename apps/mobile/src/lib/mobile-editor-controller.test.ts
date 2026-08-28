import { describe, expect, test } from "bun:test";
import {
  applyMobileEditorUpload,
  cancelMobileEditorUpload,
  flushMobileEditor,
} from "./mobile-editor-controller";

const ref = <T>(current: T) => ({ current });

describe("mobile editor controller", () => {
  test("resolves a flush when the editor acknowledges it", async () => {
    const resolver = ref<(() => void) | null>(null);
    let flushCount = 0;
    const editor = ref({
      flush: () => {
        flushCount += 1;
        resolver.current?.();
      },
    } as never);

    await flushMobileEditor(editor, resolver, 50);
    expect(flushCount).toBe(1);
    expect(resolver.current).toBeNull();
  });

  test("times out a flush when the WebView does not acknowledge it", async () => {
    const resolver = ref<(() => void) | null>(null);
    const editor = ref({ flush: () => {} } as never);

    await flushMobileEditor(editor, resolver, 0);
    expect(resolver.current).toBeNull();
  });

  test("routes image and attachment uploads to the matching editor command", () => {
    const calls: string[] = [];
    const editor = ref({
      completeImageUpload: (id: string, url: string, name: string) => calls.push(`image:${id}:${url}:${name}`),
      appendAttachment: (url: string, name: string, mimeType: string, byteSize: number) =>
        calls.push(`attachment:${url}:${name}:${mimeType}:${byteSize}`),
      cancelImageUpload: (id: string) => calls.push(`cancel:${id}`),
    } as never);

    applyMobileEditorUpload(editor, { kind: "image", url: "/image", filename: "photo.jpg" }, "upload-1", "fallback");
    applyMobileEditorUpload(editor, {
      kind: "file",
      url: "/file",
      mimeType: "application/pdf",
      byteSize: 2048,
    }, null, "document.pdf");
    cancelMobileEditorUpload(editor, "upload-2");
    cancelMobileEditorUpload(editor, null);

    expect(calls).toEqual([
      "image:upload-1:/image:photo.jpg",
      "attachment:/file:document.pdf:application/pdf:2048",
      "cancel:upload-2",
    ]);
  });
});
