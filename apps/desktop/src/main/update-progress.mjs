const nonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const normalizeUpdateProgress = (progress = {}) => {
  const total = nonNegative(progress.total);
  const transferred = nonNegative(progress.transferred);
  const percent = nonNegative(progress.percent)
    ?? (total > 0 && transferred !== null ? transferred / total * 100 : null);
  return {
    percent: percent === null ? null : Math.min(100, percent),
    transferred: transferred === null ? null : total > 0 ? Math.min(total, transferred) : transferred,
    total: total > 0 ? total : null,
    bytesPerSecond: nonNegative(progress.bytesPerSecond),
  };
};
