export class MarkdownExportMemoryLimitError extends Error {
  constructor() {
    super("This Markdown export is too large for an in-memory ZIP.");
    this.name = "MarkdownExportMemoryLimitError";
  }
}
