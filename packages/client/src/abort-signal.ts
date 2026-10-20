// React Native's AbortSignal polyfill (abort-controller@3) has neither
// throwIfAborted() nor reason, so feature-detect before relying on them.
export const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (!signal) return;
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
};
