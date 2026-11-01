import { NoteImportSession } from "@edgeever/shared/note-import";
import type { ImportFile, ImportFormat, ImportNote, ImportResource } from "@edgeever/shared/note-import/types";
import { BrowserImportIndex } from "./browser-index";

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
let session: NoteImportSession | undefined;
let abort = new AbortController();
let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
  if (data.method === "abort") { abort.abort(); return; }
  queue = queue.then(async () => {
    try {
      let result: unknown;
      switch (data.method) {
        case "scan": {
          abort = new AbortController();
          const args = data.args as { id: string; format: ImportFormat; files: ImportFile[] };
          session = new NoteImportSession(args.format, args.files, new BrowserImportIndex(args.id), args.id);
          result = await session.scan(abort.signal, path => scope.postMessage({ progress: path })); break;
        }
        case "reset": await session?.finishReading(); abort = new AbortController(); break;
        case "finish": await session?.finishReading(); break;
        case "note": result = await session!.readNote(data.args as string, abort.signal); break;
        case "part": {
          const { resource, start, end } = data.args as { resource: ImportResource; start: number; end: number };
          result = await session!.readResourcePart(resource, start, end, abort.signal); break;
        }
        case "release": await session!.releaseNote(data.args as ImportNote); break;
        case "close": await session?.close(); session = undefined; break;
      }
      scope.postMessage({ requestId: data.requestId, result }, result instanceof Uint8Array ? [result.buffer] : []);
    } catch (error) {
      scope.postMessage({ requestId: data.requestId, error: { message: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : "Error" } });
    }
  });
};
