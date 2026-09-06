type ScrollMetrics = Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">;

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export const getEditorScrollProgress = (element: ScrollMetrics | null) => {
  if (!element) return 0;
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return maxScrollTop > 0 ? clampUnit(element.scrollTop / maxScrollTop) : 0;
};

export const restoreEditorScrollProgress = (element: ScrollMetrics | null, progress: number) => {
  if (!element) return false;
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTop = maxScrollTop * clampUnit(progress);
  return true;
};
