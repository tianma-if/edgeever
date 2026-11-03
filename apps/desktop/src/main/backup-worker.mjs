import { fileURLToPath } from "node:url";

// Keep archive bytes and CPU work outside the main process while sharing the
// renderer's network session, including each user's system proxy configuration.
export const createBackupWorkerFactory = ({ utilityProcess, session }) => (data) => {
  const worker = utilityProcess.fork(fileURLToPath(new URL("../../build/backup-worker.mjs", import.meta.url)), [], {
    session, serviceName: "EdgeEver Backup", stdio: "ignore",
  });
  worker.terminate = () => worker.kill();
  worker.on("message", (message) => {
    if (message.type === "done" || message.type === "error") worker.kill();
  });
  worker.postMessage(data);
  return worker;
};
