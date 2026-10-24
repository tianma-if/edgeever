export const copyTextToClipboard = async (text: string) => {
  if (typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable) {
    try {
      return await window.edgeeverDesktop.copyText(text);
    } catch {
      return false;
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the textarea path below.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
};

export const copyHtmlToClipboard = async (html: string, plainText: string) => {
  if (typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable) {
    const copied = await window.edgeeverDesktop.copyHtml(html, plainText);
    if (!copied) throw new Error("Native rich clipboard verification failed");
    return;
  }

  if (navigator.clipboard && "ClipboardItem" in window) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    })]);
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  const container = document.createElement("div");
  container.setAttribute("contenteditable", "true");
  container.style.cssText = "position: fixed; left: -99999px; top: 0;";
  container.innerHTML = html;
  document.body.appendChild(container);
  range.selectNodeContents(container);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand("copy");
  selection?.removeAllRanges();
  container.remove();
  if (!copied) throw new Error("Clipboard copy was not available");
};

const toPngBlob = (blob: Blob): Promise<Blob | null> => {
  if (blob.type === "image/png") return Promise.resolve(blob);
  if (blob.type === "") return Promise.resolve(new Blob([blob], { type: "image/png" }));
  if (typeof document === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = document.createElement("img");
    const url = URL.createObjectURL(blob);
    const finish = (png: Blob | null) => {
      URL.revokeObjectURL(url);
      image.onload = image.onerror = null;
      image.src = "";
      resolve(png);
    };
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const releaseCanvas = () => { canvas.width = canvas.height = 0; };
      try {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          releaseCanvas();
          finish(null);
          return;
        }
        context.drawImage(image, 0, 0);
        canvas.toBlob((png) => {
          releaseCanvas();
          finish(png);
        }, "image/png");
      } catch {
        releaseCanvas();
        finish(null);
      }
    };
    image.onerror = () => finish(null);
    image.src = url;
  });
};

export const copyImageUrlToClipboard = async (url: string): Promise<boolean> => {
  const copyImage = typeof window !== "undefined" ? window.edgeeverDesktop?.copyImage : undefined;
  if (copyImage) {
    try {
      const response = await fetch(url);
      if (!response.ok) return false;
      return await copyImageBlobToClipboard(await response.blob());
    } catch {
      return false;
    }
  }

  if (typeof window === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }

  try {
    // Safari keeps the click gesture only when write() runs now and the
    // ClipboardItem payload is still a Promise. Fetch and PNG conversion stay inside it.
    const pngPromise = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Image fetch failed");
        return response.blob();
      })
      .then((blob) => toPngBlob(blob))
      .then((png) => {
        if (!png) throw new Error("PNG conversion failed");
        return png;
      });
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": pngPromise,
      }),
    ]);
    return true;
  } catch (error) {
    console.warn("Failed to copy image URL to clipboard:", error);
    return false;
  }
};

export const copyImageBlobToClipboard = async (blob: Blob): Promise<boolean> => {
  const copyImage = typeof window !== "undefined" ? window.edgeeverDesktop?.copyImage : undefined;
  if (copyImage) {
    // Renderer clipboard writes are denied in the desktop app. Text and HTML
    // already go through the main process; image bytes follow the same path.
    try {
      const png = await toPngBlob(blob);
      if (!png) return false;
      return await copyImage(new Uint8Array(await png.arrayBuffer()));
    } catch {
      return false;
    }
  }

  if (typeof window === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }

  try {
    // Safari keeps the click gesture only when write() runs now and the
    // ClipboardItem payload is still a Promise. JPEG conversion stays inside it.
    const pngPromise = toPngBlob(blob).then((png) => {
      if (!png) throw new Error("PNG conversion failed");
      return png;
    });
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": pngPromise,
      }),
    ]);
    return true;
  } catch (error) {
    console.warn("Failed to write image blob to clipboard:", error);
    return false;
  }
};

const desktopClipboardBridges = new WeakSet<object>();

const clipboardWriteFailed = () => new DOMException("Clipboard write failed", "NotAllowedError");

const clipboardItemText = async (item: ClipboardItem, type: string) => (await item.getType(type)).text();

const imageClipboardType = (types: ReadonlyArray<string>) => (
  ["image/png", "image/jpeg", "image/webp", "image/gif"].find((type) => types.includes(type))
);

// Electron denies every renderer permission request, including clipboard-write.
// Streamdown's code, diagram, and table controls call navigator.clipboard and
// ignore the rejection, so those buttons do nothing in the desktop app.
const writeDesktopClipboardText = async (data: string) => {
  if (!await copyTextToClipboard(data)) throw clipboardWriteFailed();
};

const writeDesktopClipboardItems = async (items: ClipboardItems) => {
  if (!items.length) throw clipboardWriteFailed();
  for (const item of items) {
    const types = item.types;
    if (types.includes("text/html")) {
      const plain = types.includes("text/plain") ? await clipboardItemText(item, "text/plain") : "";
      await copyHtmlToClipboard(await clipboardItemText(item, "text/html"), plain);
      continue;
    }
    const imageType = imageClipboardType(types);
    if (imageType) {
      if (!await copyImageBlobToClipboard(await item.getType(imageType))) throw clipboardWriteFailed();
      continue;
    }
    if (types.includes("text/plain")) {
      if (!await copyTextToClipboard(await clipboardItemText(item, "text/plain"))) throw clipboardWriteFailed();
      continue;
    }
    throw clipboardWriteFailed();
  }
};

const assignClipboardMethod = (clipboard: Clipboard, name: "write" | "writeText", value: Clipboard["write"] | Clipboard["writeText"]) => {
  try {
    if (name === "write") clipboard.write = value as Clipboard["write"];
    else clipboard.writeText = value as Clipboard["writeText"];
  } catch {
    Object.defineProperty(clipboard, name, { configurable: true, enumerable: true, writable: true, value });
  }
};

export const installDesktopClipboardBridge = () => {
  if (typeof window === "undefined" || window.edgeeverDesktop?.isAvailable !== true) return false;
  const clipboard = navigator.clipboard;
  if (!clipboard || desktopClipboardBridges.has(clipboard)) return false;
  assignClipboardMethod(clipboard, "writeText", writeDesktopClipboardText);
  assignClipboardMethod(clipboard, "write", writeDesktopClipboardItems);
  desktopClipboardBridges.add(clipboard);
  return true;
};

