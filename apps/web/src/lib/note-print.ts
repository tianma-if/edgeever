import { DOMSerializer } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { TiptapDoc } from "@edgeever/shared";
import { getAppPagePath, getMessageTargetOrigin } from "@/lib/app-page-path";
import { createClientUuid } from "@/lib/client-id";

export const NOTE_PRINT_MESSAGE = "edgeever:note-print";
export const NOTE_PRINT_READY_MESSAGE = "edgeever:note-print-ready";
export const NOTE_PRINT_PATH = getAppPagePath("note-print.html", import.meta.env.BASE_URL);

export type NotePrintLabels = {
  close: string;
  error: string;
  hint: string;
  preparing: string;
  print: string;
  ready: string;
};

export type NotePrintPayload = {
  type: typeof NOTE_PRINT_MESSAGE;
  token: string;
  title: string;
  notebook: string;
  tags: string[];
  updatedAt: string;
  html: string;
  language: string;
  labels: NotePrintLabels;
};

type NotePrintReadyMessage = {
  type: typeof NOTE_PRINT_READY_MESSAGE;
  token: string;
};

export const serializeNoteDocumentForPrint = (editor: Editor, document: TiptapDoc) => {
  const node = editor.schema.nodeFromJSON(document);
  const container = window.document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(node.content));
  return container.innerHTML;
};

export const openNotePrintPreview = (
  payload: Omit<NotePrintPayload, "type" | "token">,
  preopenedWindow?: Window,
) => {
  const token = createClientUuid();
  let printWindow: Window | null = preopenedWindow ?? null;

  const handleMessage = (event: MessageEvent<NotePrintReadyMessage>) => {
    if (
      event.origin !== window.location.origin ||
      event.source !== printWindow ||
      event.data?.type !== NOTE_PRINT_READY_MESSAGE ||
      event.data.token !== token
    ) {
      return;
    }

    window.removeEventListener("message", handleMessage);
    printWindow?.postMessage(
      {
        ...payload,
        type: NOTE_PRINT_MESSAGE,
        token,
      } satisfies NotePrintPayload,
      getMessageTargetOrigin(window.location.origin)
    );
  };

  window.addEventListener("message", handleMessage);
  const printUrl = `${NOTE_PRINT_PATH}?token=${encodeURIComponent(token)}`;

  if (printWindow) {
    try {
      printWindow.location.href = printUrl;
    } catch {
      window.removeEventListener("message", handleMessage);
      return false;
    }
  } else {
    printWindow = window.open(printUrl, "_blank");
  }

  if (!printWindow) {
    window.removeEventListener("message", handleMessage);
    return false;
  }

  window.setTimeout(() => window.removeEventListener("message", handleMessage), 30_000);
  return true;
};
