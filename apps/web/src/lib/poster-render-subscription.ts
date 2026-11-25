import { POSTER_RENDER_AVAILABLE } from "@edgeever/shared/poster-render-events";

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 60_000;
const STABLE_CONNECTION_MS = 30_000;

export function subscribeToPosterRenders(openSocket: () => WebSocket, drain: () => Promise<void>) {
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = INITIAL_RECONNECT_MS;
  let stopped = false;
  let draining = false;
  let wakePending = false;

  const wake = async () => {
    // A notification received during an empty claim must trigger another check.
    wakePending = true;
    if (draining) return;
    draining = true;
    try {
      while (wakePending && !stopped) {
        wakePending = false;
        await drain();
      }
    } catch {
      // Reconnect with backoff to reconcile a failed claim, even if no new job arrives.
      if (!stopped) socket?.close();
    } finally {
      draining = false;
    }
  };

  const reconnect = () => {
    if (stopped || reconnectTimer !== undefined || navigator.onLine === false) return;
    const delay = reconnectDelay * (0.75 + Math.random() * 0.25);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped || socket || navigator.onLine === false) return;
    let connection: WebSocket;
    try {
      connection = openSocket();
    } catch {
      reconnect();
      return;
    }
    socket = connection;
    let openedAt = 0;
    connection.addEventListener("open", () => {
      if (socket !== connection || stopped) return;
      openedAt = Date.now();
      void wake();
    });
    connection.addEventListener("message", (event) => {
      if (socket === connection && !stopped && event.data === POSTER_RENDER_AVAILABLE) void wake();
    });
    connection.addEventListener("close", () => {
      if (socket !== connection) return;
      socket = undefined;
      if (openedAt && Date.now() - openedAt >= STABLE_CONNECTION_MS) reconnectDelay = INITIAL_RECONNECT_MS;
      reconnect();
    });
  };

  const cancelReconnect = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };
  const offline = () => {
    cancelReconnect();
    socket?.close();
  };
  const online = () => {
    cancelReconnect();
    reconnectDelay = INITIAL_RECONNECT_MS;
    connect();
  };
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  connect();
  return () => {
    stopped = true;
    window.removeEventListener("offline", offline);
    window.removeEventListener("online", online);
    cancelReconnect();
    socket?.close();
  };
}
