import { parentPort, workerData } from "node:worker_threads";

type ControlMessage = { type: string };
type Port = {
  on(event: "message", listener: (message: ControlMessage) => void): unknown;
  postMessage(message: unknown): void;
  close(): void;
};

export const backupWorkerRuntime = async (): Promise<{ data: unknown; port: Port; request: typeof fetch }> => {
  // Preserve the existing Node execution contract for non-Electron callers.
  if (parentPort) return { data: workerData, port: parentPort, request: fetch };

  const utilityPort = process.parentPort;
  const { net } = await import("electron");
  const data = await new Promise<unknown>(resolve => utilityPort.once("message", event => resolve(event.data)));
  const listeners = new Set<(event: { data: ControlMessage }) => void>();
  return {
    data, request: net.fetch as typeof fetch,
    port: {
      on(_event, listener) {
        const receive = (event: { data: ControlMessage }) => listener(event.data);
        listeners.add(receive); utilityPort.on("message", receive);
      },
      postMessage: message => utilityPort.postMessage(message),
      // The parent reaps the utility process after receiving its terminal result.
      close() { for (const receive of listeners) utilityPort.removeListener("message", receive); },
    },
  };
};
