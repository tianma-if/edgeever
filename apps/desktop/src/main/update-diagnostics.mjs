export const createUpdateDiagnostic = (error, { stage, version, platform, arch, now = new Date() }) => {
  // Keep actionable errors, not response bodies, stacks, credentials or local paths.
  const message = String(error?.message || error || "Unknown update error")
    .split(/\r?\n(?:XML:|Response:|Headers:|Body:|\s*at )/i, 1)[0]
    .replace(/https?:\/\/[^\s<>"')]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch { return "[URL]"; }
    })
    .replace(/(?:authorization|cookie|token|password|secret)\s*[:=]\s*[^\r\n,;]+/gi, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n"<>]+/g, "[local path]")
    .replace(/\/(?:Users|home)\/[^\s"<>]+/g, "[local path]")
    .slice(0, 1200);
  const rawCode = String(error?.code || message.match(/\b(?:ERR_[A-Z0-9_]+|E[A-Z]{3,})\b/)?.[0] || "");
  return {
    at: now.toISOString(), stage, version, platform, arch,
    code: /^[A-Z0-9_-]{1,80}$/.test(rawCode) ? rawCode : null,
    message,
    source: "https://github.com/tianma-if/edgeever/releases",
  };
};
