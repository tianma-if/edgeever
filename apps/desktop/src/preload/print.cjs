const { contextBridge, ipcRenderer } = require("electron");

const normalizeIpcBytes = (value) => {
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy;
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value === "object" && value.type === "Buffer") return normalizeIpcBytes(value.data);
  return new Uint8Array();
};

// The print window exposes only PDF saving. It does not get the desktop bridge.
contextBridge.exposeInMainWorld("edgeeverPrint", Object.freeze({
  savePdf: () => ipcRenderer.invoke("desktop:print-pdf").then(normalizeIpcBytes),
}));
