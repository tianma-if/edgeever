export const writeRichClipboard = (clipboard, input) => {
  const html = input?.html;
  const plainText = input?.plainText;
  if (typeof html !== "string" || typeof plainText !== "string") {
    throw new TypeError("Clipboard HTML and plain text must be strings");
  }

  clipboard.write({ html, text: plainText });
  return clipboard.readText() === plainText && clipboard.readHTML().trim().length > 0;
};
