const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const buildMarkdownFilename = (title: string, fallback: string) => {
  const sanitized = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const basename = sanitized || fallback;
  const safeBasename = WINDOWS_RESERVED_NAME.test(basename) ? `_${basename}` : basename;
  return /\.md$/i.test(safeBasename) ? safeBasename : `${safeBasename}.md`;
};

export const createMarkdownFile = (markdown: string, title: string, fallback: string) => ({
  blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  filename: buildMarkdownFilename(title, fallback),
});

export const downloadMarkdownFile = (markdown: string, title: string, fallback: string) => {
  const { blob, filename } = createMarkdownFile(markdown, title, fallback);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
