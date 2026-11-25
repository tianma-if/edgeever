import { POSTER_RENDER_AVAILABLE, POSTER_RENDER_EVENTS_PROTOCOL } from "@edgeever/shared/poster-render-events";
import { AppError } from "./app-error";
import { isDatabaseDailyQuotaError } from "./database-errors";
import { hasPendingPosterRender, requestPosterRender, type PosterRenderRequest } from "./poster-render-service";
import type { DatabaseAdapter } from "./storage-contract";

type QueueResult = Awaited<ReturnType<typeof requestPosterRender>>;
const retryDelayMs = 5_000;

export function createCloudflarePosterRenderEvents(namespace: DurableObjectNamespace) {
  return {
    connectPosterRenderEvents: (_request: Request, workspace: string) => namespace.getByName(workspace)
      .fetch("https://poster-render.internal/events", { headers: { Upgrade: "websocket" } }),
    async enqueuePosterRender(input: PosterRenderRequest): Promise<QueueResult> {
      const response = await namespace.getByName(input.workspace).fetch("https://poster-render.internal/queue", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (response.ok) return response.json<QueueResult>();
      const error = await response.json<{ code: string; message: string }>();
      throw new AppError(error.code, error.message, response.status);
    },
  };
}

export class PosterRenderEvents {
  constructor(private readonly state: DurableObjectState, private readonly env: { DB: DatabaseAdapter }) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/events" && request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": POSTER_RENDER_EVENTS_PROTOCOL },
      });
    }
    if (pathname !== "/queue" || request.method !== "POST") return new Response(null, { status: 404 });

    const input = await request.json<PosterRenderRequest>();
    return this.state.blockConcurrencyWhile(async () => {
      try {
        // Persist the recovery alarm before the D1 write. Serializing this
        // section with alarm delivery prevents it from running before commit.
        await this.state.storage.transaction(async (transaction) => {
          if (await transaction.getAlarm() !== null) return;
          await transaction.put("workspace", input.workspace);
          await transaction.setAlarm(Date.now() + retryDelayMs);
        });
        let notificationSent = false;
        const job = await requestPosterRender(this.env.DB, input, () => {
          try {
            this.notify(this.state.getWebSockets());
            notificationSent = true;
          } catch (error) {
            console.error("Poster render notification left for alarm retry", error);
          }
        });
        if (notificationSent) {
          await this.state.storage.deleteAlarm().catch((error) => console.error("Poster render alarm cleanup failed", error));
        }
        return Response.json(job);
      } catch (failure) {
        if (failure instanceof AppError) return Response.json({ code: failure.code, message: failure.message }, { status: failure.status });
        if (isDatabaseDailyQuotaError(failure)) {
          return Response.json({ code: "database_daily_quota_exceeded", message: "The instance's Cloudflare D1 daily database quota is exhausted." }, { status: 503 });
        }
        console.error("Poster render queue failed", failure);
        return Response.json({ code: "poster_queue_unavailable", message: "Could not confirm the render request. Retry with the same poster revision." }, { status: 503 });
      }
    });
  }

  async alarm(): Promise<void> {
    // Return the promise to Cloudflare so transient D1 errors retry the alarm.
    await this.state.blockConcurrencyWhile(async () => {
      const sockets = this.state.getWebSockets();
      if (!sockets.length) return;
      const workspace = await this.state.storage.get<string>("workspace");
      if (workspace && await hasPendingPosterRender(this.env.DB, workspace)) this.notify(sockets);
    });
  }

  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, "Poster render events are server-only");
  }

  private notify(sockets: WebSocket[]): void {
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(POSTER_RENDER_AVAILABLE);
      } catch {
        // A disconnected subscriber reconciles the stored queue on reconnect.
        socket.close(1011, "Reconnect to check the render queue");
      }
    }
  }
}
