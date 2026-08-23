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

export const copyImageBlobToClipboard = async (blob: Blob): Promise<boolean> => {
  if (typeof window === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
    await navigator.clipboard.write([
      new ClipboardItem({
        [type]: blob,
      }),
    ]);
    return true;
  } catch (error) {
    // If writing jpeg directly fails in some browsers (e.g. Safari only supports image/png),
    // try converting blob to png via an image/canvas in memory
    try {
      const img = document.createElement("img");
      const url = URL.createObjectURL(blob);
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed for clipboard conversion"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) return false;
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": pngBlob,
        }),
      ]);
      return true;
    } catch {
      console.warn("Failed to write image blob to clipboard:", error);
      return false;
    }
  }
};

