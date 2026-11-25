import { POSTER_RENDER_AVAILABLE, POSTER_RENDER_EVENTS_PROTOCOL } from "@edgeever/shared/poster-render-events";
import { requestPosterRender } from "../apps/api/src/poster-render-service.ts";

export function createSelfHostedPosterRenderEvents(db) {
  const sockets = new Set();
  let stopping = false;
  return {
    websocket: {
      idleTimeout: 120,
      sendPings: true,
      closeOnBackpressureLimit: true,
      open(socket) {
        if (stopping) {
          socket.close(1001, "Server shutting down");
          return;
        }
        sockets.add(socket);
        socket.subscribe(socket.data.workspace);
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(socket) {
        socket.close(1008, "Poster render events are server-only");
      },
    },

    upgrade(server, request, workspace) {
      return !stopping && server.upgrade(request, {
        data: { workspace },
        headers: { "Sec-WebSocket-Protocol": POSTER_RENDER_EVENTS_PROTOCOL },
      });
    },

    enqueue(server, input) {
      // A server restart drops sockets, so reconnecting subscribers recover
      // any committed jobs that the previous process could not announce.
      return requestPosterRender(db, input, () => {
        try {
          server.publish(input.workspace, POSTER_RENDER_AVAILABLE);
        } catch (error) {
          console.error("Poster render notification failed", error);
          for (const socket of sockets) {
            if (socket.data.workspace === input.workspace) socket.close(1011, "Reconnect to check the render queue");
          }
        }
      });
    },

    close() {
      stopping = true;
      for (const socket of sockets) socket.close(1001, "Server shutting down");
    },
  };
}
