import {
  PLUGIN_SANDBOX_PROTOCOL_VERSION,
  type SandboxErrorPayload,
  type SandboxInboundMessage,
  type SandboxOutboundMessage,
  type SandboxQueryMethod,
  type SandboxRequestMethod,
} from "./protocol.ts";

/** Transport implemented by each native host for its WebView bridge. */
export interface SandboxTransport {
  post(message: SandboxOutboundMessage): void;
  subscribe(listener: (message: SandboxInboundMessage) => void): () => void;
}

export class SandboxRequestError extends Error {
  readonly code?: string;

  constructor(payload: SandboxErrorPayload) {
    super(payload.message);
    this.name = "SandboxRequestError";
    this.code = payload.code;
  }
}

export class SandboxUnsupportedError extends Error {
  constructor(api: string) {
    super(`${api} is not supported by the mobile plugin sandbox yet.`);
    this.name = "SandboxUnsupportedError";
  }
}

export interface SandboxRequestOptions {
  timeoutMs?: number;
}

export interface SandboxBridge {
  readonly protocol: typeof PLUGIN_SANDBOX_PROTOCOL_VERSION;
  request<Result>(method: SandboxRequestMethod, params?: unknown, options?: SandboxRequestOptions): Promise<Result>;
  /** Fire-and-forget signal that does not need a host reply. */
  notify(message: Exclude<SandboxOutboundMessage, { type: "request" | "response" | "query-result" }>): void;
  send(message: SandboxOutboundMessage): void;
  /** Register a handler for host-initiated queries (for example `panel.beforeClose`). */
  handle(method: SandboxQueryMethod, handler: (params: unknown) => unknown | Promise<unknown>): () => void;
  subscribe(listener: (message: Exclude<SandboxInboundMessage, { type: "request" | "response" }>) => void): () => void;
  dispose(reason?: string): void;
}

export interface SandboxBridgeOptions {
  timeoutMs?: number;
  onProtocolError?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const errorPayload = (error: unknown): SandboxErrorPayload => {
  if (error instanceof Error) {
    const candidate = (error as unknown as { code?: unknown }).code;
    const code = typeof candidate === "string" ? candidate : undefined;
    return { message: error.message, ...(code ? { code } : {}) };
  }
  return { message: String(error) };
};

export const createSandboxBridge = (transport: SandboxTransport, options: SandboxBridgeOptions = {}): SandboxBridge => {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const queryHandlers = new Map<SandboxQueryMethod, (params: unknown) => unknown | Promise<unknown>>();
  const listeners = new Set<(message: Exclude<SandboxInboundMessage, { type: "request" | "response" }>) => void>();
  let nextId = 1;
  let disposed = false;

  const post = (message: SandboxOutboundMessage) => {
    if (disposed) return;
    if (message.v !== PLUGIN_SANDBOX_PROTOCOL_VERSION) {
      throw new Error(`Unexpected sandbox protocol version: ${String((message as { v?: unknown }).v)}`);
    }
    transport.post(message);
  };

  const failPending = (reason: string) => {
    for (const [id, entry] of pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      pendingRequests.delete(id);
    }
  };

  const unsubscribe = transport.subscribe((raw) => {
    if (disposed) return;
    const message = raw as SandboxInboundMessage;
    if (!message || message.v !== PLUGIN_SANDBOX_PROTOCOL_VERSION) {
      options.onProtocolError?.(`Ignored sandbox message with unsupported protocol version: ${String((message as { v?: unknown } | null)?.v)}`);
      return;
    }
    if (message.type === "response") {
      const entry = pendingRequests.get(message.id);
      if (!entry) return;
      pendingRequests.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new SandboxRequestError(message.error ?? { message: "Sandbox request failed." }));
      return;
    }
    if (message.type === "request") {
      const handler = queryHandlers.get(message.method);
      if (!handler) {
        post({
          v: PLUGIN_SANDBOX_PROTOCOL_VERSION,
          type: "query-result",
          id: message.id,
          ok: false,
          error: { message: `Unsupported sandbox query: ${message.method}` },
        });
        return;
      }
      void (async () => {
        try {
          const result = await handler(message.params);
          post({ v: PLUGIN_SANDBOX_PROTOCOL_VERSION, type: "query-result", id: message.id, ok: true, result });
        } catch (error) {
          post({ v: PLUGIN_SANDBOX_PROTOCOL_VERSION, type: "query-result", id: message.id, ok: false, error: errorPayload(error) });
        }
      })();
      return;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    protocol: PLUGIN_SANDBOX_PROTOCOL_VERSION,
    request<Result>(method: SandboxRequestMethod, params?: unknown, requestOptions?: SandboxRequestOptions): Promise<Result> {
      if (disposed) return Promise.reject(new Error("Sandbox bridge has been disposed."));
      const id = nextId++;
      const timeoutMs = requestOptions?.timeoutMs ?? defaultTimeoutMs;
      return new Promise<Result>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`Sandbox request timed out after ${timeoutMs}ms: ${method}`));
        }, timeoutMs);
        pendingRequests.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
        });
        try {
          post({ v: PLUGIN_SANDBOX_PROTOCOL_VERSION, type: "request", id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    notify(message) {
      post(message as SandboxOutboundMessage);
    },
    send(message) {
      post(message);
    },
    handle(method, handler) {
      queryHandlers.set(method, handler);
      return () => {
        if (queryHandlers.get(method) === handler) queryHandlers.delete(method);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(reason = "Sandbox bridge disposed.") {
      if (disposed) return;
      disposed = true;
      failPending(reason);
      unsubscribe();
      queryHandlers.clear();
      listeners.clear();
    },
  };
};
