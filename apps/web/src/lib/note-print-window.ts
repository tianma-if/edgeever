import { getAppPagePath } from "@/lib/app-page-path";

export const NOTE_PRINT_PATH = getAppPagePath("note-print.html", import.meta.env.BASE_URL);

// Electron's file renderer reports location.origin as file://, while its
// postMessage events use the serialized opaque origin null.
export const notePrintMessageOrigin = (origin: string) => origin === "file://" ? "null" : origin;

// Reserve the window during the menu click, before a different note is loaded.
// Desktop permits this dedicated page, but deliberately blocks about:blank.
export const preopenNotePrintWindow = () => window.open(NOTE_PRINT_PATH, "_blank");
