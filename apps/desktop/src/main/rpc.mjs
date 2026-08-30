import { createInterface } from "node:readline";

export const SIDECAR_PROTOCOL_VERSION = 2;

export class SidecarRpcClient {
  #child;
  #nextId = 1;
  #pending = new Map();
  #ready = null;
  #readyMessage = null;
  #readyError = null;

  constructor(child) {
    this.#child = child;
    const input = createInterface({ input: child.stdout });
    input.on("line", (line) => this.#handleLine(line));
    child.on("exit", (code, signal) => {
      const error = new Error(`EdgeEver sidecar exited (${code ?? signal ?? "unknown"})`);
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
      this.#ready?.reject(error);
      this.#ready = null;
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.event === "ready") {
      if (message.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
        const error = new Error(
          `Unsupported EdgeEver sidecar protocol: expected ${SIDECAR_PROTOCOL_VERSION}, received ${message.protocolVersion ?? "unknown"}`,
        );
        this.#readyError = error;
        this.#ready?.reject(error);
        this.#ready = null;
        return;
      }
      this.#readyMessage = message;
      this.#ready?.resolve(message);
      this.#ready = null;
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || "Sidecar request failed"));
    else pending.resolve(message.result);
  }

  waitUntilReady(timeoutMs = 5000) {
    if (this.#readyMessage) return Promise.resolve(this.#readyMessage);
    if (this.#readyError) return Promise.reject(this.#readyError);
    if (!this.#ready) {
      this.#ready = {};
      this.#ready.promise = new Promise((resolve, reject) => {
        this.#ready.resolve = resolve;
        this.#ready.reject = reject;
      });
    }
    return Promise.race([
      this.#ready.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Sidecar ready timeout")), timeoutMs)),
    ]);
  }

  request(method, params = {}, timeoutMs = 10000) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Sidecar request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close() {
    this.#child.stdin.end();
  }
}
