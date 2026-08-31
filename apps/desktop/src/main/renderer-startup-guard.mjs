export const RENDERER_STARTUP_TIMEOUT_MS = 15_000;

export const createRendererStartupGuard = ({
  onFailure,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = RENDERER_STARTUP_TIMEOUT_MS,
}) => {
  let timer = null;
  let settled = false;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const fail = (details) => {
    if (settled) return false;
    settled = true;
    cancelTimer();
    onFailure(details);
    return true;
  };

  return {
    arm() {
      if (settled || timer !== null) return;
      timer = setTimer(() => fail({ kind: "startup-timeout" }), timeoutMs);
    },
    complete() {
      if (settled) return false;
      settled = true;
      cancelTimer();
      return true;
    },
    fail,
  };
};
