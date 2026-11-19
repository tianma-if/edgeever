import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const requestedExecutablePath = process.argv[2]?.trim();
const executablePath = requestedExecutablePath ? resolve(requestedExecutablePath) : "";
if (!executablePath || !existsSync(executablePath) || !statSync(executablePath).isFile()) {
  throw new Error(`Packaged desktop executable is missing: ${executablePath || "<not provided>"}`);
}

const fixtureBytes = Buffer.from("EdgeEver private protocol E2E fixture.\n", "utf8");
const fixtureText = fixtureBytes.toString("utf8");
const cachedResourceId = "protocol-e2e-resource";
const downloadFilename = "edgeever-protocol-e2e.txt";
const testDirectory = await mkdtemp(join(tmpdir(), "edgeever-protocol-e2e-"));
const userDataDirectory = join(testDirectory, "profile");
const resourceCacheDirectory = join(userDataDirectory, "resource-cache");
const inputFixturePath = join(testDirectory, downloadFilename);
const downloadedPath = join(testDirectory, "downloads", downloadFilename);
const processOutput = [];
let child = null;
let cdp = null;

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const availablePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.unref();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Could not reserve a DevTools port"));
      return;
    }
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const stopProcess = async (processToStop) => {
  if (!processToStop || processToStop.exitCode !== null || !processToStop.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(processToStop.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    processToStop.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolveClosed) => processToStop.once("close", resolveClosed)),
    wait(5_000),
  ]);
};

const findRendererTarget = async (port) => {
  const deadline = Date.now() + (Number(process.env.EDGE_EVER_DESKTOP_E2E_TIMEOUT_MS) || 45_000);
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`DevTools target request failed (${response.status})`);
      const targets = await response.json();
      const target = targets.find((candidate) =>
        candidate.type === "page" && String(candidate.url || "").startsWith("edgeever-app://app/index.html"));
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw new Error([
    "Could not find the packaged edgeever-app renderer target.",
    lastError instanceof Error && lastError.message,
    processOutput.length > 0 && `Process output:\n${processOutput.join("")}`,
  ].filter(Boolean).join("\n\n"));
};

const connectCdp = (webSocketUrl) => new Promise((resolveConnection, rejectConnection) => {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  const timeout = setTimeout(() => rejectConnection(new Error("DevTools WebSocket connection timed out")), 10_000);
  const connection = {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolveCommand, rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    resolveConnection(connection);
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    rejectConnection(new Error("DevTools WebSocket connection failed"));
  }, { once: true });
  socket.addEventListener("close", () => {
    for (const { rejectCommand } of pending.values()) rejectCommand(new Error("DevTools WebSocket closed"));
    pending.clear();
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) command.rejectCommand(new Error(`${message.error.message} (${message.error.code})`));
    else command.resolveCommand(message.result);
  });
});

const evaluate = async (expression) => {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Renderer evaluation failed");
  }
  return result.result?.value;
};

const waitForDownloadedFile = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (existsSync(downloadedPath)) return;
    await wait(100);
  }
  throw new Error(`Resource download did not create ${downloadedPath}`);
};

const waitForRendererBootstrap = async () => {
  const diagnosticLogPath = join(userDataDirectory, "logs", "desktop.log");
  const deadline = Date.now() + (Number(process.env.EDGE_EVER_DESKTOP_E2E_TIMEOUT_MS) || 45_000);
  while (Date.now() < deadline) {
    if (existsSync(diagnosticLogPath)) {
      const log = await readFile(diagnosticLogPath, "utf8");
      if (log.includes("renderer.bootstrap-ready")) return;
    }
    if (child?.exitCode !== null) break;
    await wait(100);
  }
  throw new Error("Renderer bootstrap did not complete before protocol e2e");
};

const attachFileToInput = async (filePath) => {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const created = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          let input = document.querySelector("#edgeever-protocol-file-input");
          if (!input) {
            input = document.createElement("input");
            input.id = "edgeever-protocol-file-input";
            input.type = "file";
            document.body.append(input);
          }
          return input;
        })()`,
      });
      const objectId = created.result?.objectId;
      if (!objectId) throw new Error("File input object is missing");
      await cdp.send("DOM.setFileInputFiles", { objectId, files: [filePath] });
      const hasFile = await evaluate(
        `document.querySelector("#edgeever-protocol-file-input")?.files?.length === 1`,
      );
      if (hasFile) return;
      lastError = new Error("File input did not retain the attached file");
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw lastError ?? new Error("Could not attach a file to the protocol e2e input");
};

try {
  await mkdir(resourceCacheDirectory, { recursive: true });
  await mkdir(join(testDirectory, "downloads"), { recursive: true });
  await writeFile(inputFixturePath, fixtureBytes);
  await writeFile(join(userDataDirectory, "installation-confirmed"), "e2e");
  await writeFile(join(resourceCacheDirectory, `${cachedResourceId}.bin`), fixtureBytes);
  await writeFile(join(resourceCacheDirectory, `${cachedResourceId}.json`), JSON.stringify({
    contentType: "text/plain; charset=utf-8",
    byteSize: fixtureBytes.byteLength,
    sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
  }));

  const port = await availablePort();
  child = spawn(executablePath, [
    `--user-data-dir=${userDataDirectory}`,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
  ], {
    env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => processOutput.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => processOutput.push(chunk.toString()));

  await waitForRendererBootstrap();
  const target = await findRendererTarget(port);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Page.enable");

  const appProtocol = await evaluate(`(async () => {
    const response = await fetch(new URL("extensions/registry.json", window.location.href), { cache: "no-store" });
    const registry = await response.json();
    return {
      origin: window.location.origin,
      secureContext: window.isSecureContext,
      status: response.status,
      contentType: response.headers.get("content-type"),
      hasEntries: Array.isArray(registry.entries),
      desktopBridge: Boolean(window.edgeeverDesktop?.isAvailable),
    };
  })()`);
  if (appProtocol.origin !== "edgeever-app://app") throw new Error(`Unexpected app origin: ${appProtocol.origin}`);
  if (!appProtocol.secureContext) throw new Error("The private app origin is not a secure context");
  if (!appProtocol.desktopBridge) throw new Error("The packaged desktop bridge is unavailable");
  if (appProtocol.status !== 200 || !appProtocol.contentType?.includes("application/json") || !appProtocol.hasEntries) {
    throw new Error(`Bundled marketplace fetch failed: ${JSON.stringify(appProtocol)}`);
  }

  await attachFileToInput(inputFixturePath);

  const staged = await evaluate(`(async () => {
    const input = document.querySelector("#edgeever-protocol-file-input");
    const file = input?.files?.[0];
    if (!file || !window.edgeeverDesktop) throw new Error("File input or desktop bridge is unavailable");
    const pending = await window.edgeeverDesktop.beginStagedResource({
      memoId: "protocol-e2e-memo",
      name: file.name,
      type: file.type,
      size: file.size,
    });
    await window.edgeeverDesktop.appendStagedResource(pending.id, await file.arrayBuffer());
    await window.edgeeverDesktop.completeStagedResource(pending.id);
    const response = await fetch("edgeever-staged://" + pending.id);
    const bridged = await window.edgeeverDesktop.readStagedResource(pending.id);
    return {
      id: pending.id,
      filename: file.name,
      fileText: await file.text(),
      fetchStatus: response.status,
      fetchText: await response.text(),
      bridgeText: new TextDecoder().decode(bridged.bytes),
    };
  })()`);
  if (
    staged.filename !== downloadFilename
    || staged.fileText !== fixtureText
    || staged.fetchStatus !== 200
    || staged.fetchText !== fixtureText
    || staged.bridgeText !== fixtureText
  ) {
    throw new Error(`Staged resource round trip failed: ${JSON.stringify(staged)}`);
  }

  const cachedResource = await evaluate(`(async () => {
    const url = "edgeever-resource://resource/${cachedResourceId}";
    const full = await fetch(url);
    const range = await fetch(url, { headers: { Range: "bytes=9-15" } });
    return {
      fullStatus: full.status,
      fullText: await full.text(),
      rangeStatus: range.status,
      rangeText: await range.text(),
      contentRange: range.headers.get("content-range"),
    };
  })()`);
  if (
    cachedResource.fullStatus !== 200
    || cachedResource.fullText !== fixtureText
    || cachedResource.rangeStatus !== 206
    || cachedResource.rangeText !== fixtureText.slice(9, 16)
    || cachedResource.contentRange !== `bytes 9-15/${fixtureBytes.byteLength}`
  ) {
    throw new Error(`Cached resource protocol failed: ${JSON.stringify(cachedResource)}`);
  }

  const aliasedResource = await evaluate(`(async () => {
    const bridge = window.edgeeverDesktop;
    await bridge.recordStagedResourceAlias(${JSON.stringify(staged.id)}, "/api/v1/resources/${cachedResourceId}/blob");
    await bridge.removeStagedResource(${JSON.stringify(staged.id)});
    const [pending, aliases, response, bridged] = await Promise.all([
      bridge.listStagedResources(),
      bridge.listStagedResourceAliases("protocol-e2e-memo"),
      fetch("edgeever-staged://${staged.id}"),
      bridge.readStagedResource(${JSON.stringify(staged.id)}),
    ]);
    return {
      pending: pending.some((item) => item.id === ${JSON.stringify(staged.id)}),
      alias: aliases.find((item) => item.id === ${JSON.stringify(staged.id)})?.resourceId,
      status: response.status,
      text: await response.text(),
      bridgeText: new TextDecoder().decode(bridged.bytes),
    };
  })()`);
  if (
    aliasedResource.pending
    || aliasedResource.alias !== cachedResourceId
    || aliasedResource.status !== 200
    || aliasedResource.text !== fixtureText
    || aliasedResource.bridgeText !== fixtureText
  ) {
    throw new Error(`Uploaded staged resource alias failed: ${JSON.stringify(aliasedResource)}`);
  }

  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: join(testDirectory, "downloads"),
    eventsEnabled: true,
  });
  await evaluate(`(() => {
    const url = new URL("edgeever-resource://resource/${cachedResourceId}");
    url.searchParams.set("download", "${downloadFilename}");
    const anchor = document.createElement("a");
    anchor.href = url.href;
    anchor.download = "${downloadFilename}";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  })()`);
  await waitForDownloadedFile();
  if (!(await readFile(downloadedPath)).equals(fixtureBytes)) throw new Error("Downloaded resource bytes changed");

  console.log(JSON.stringify({
    ok: true,
    executablePath,
    origin: appProtocol.origin,
    checks: ["app-assets", "file-input", "staged-resource", "cached-resource-range", "staged-resource-alias", "download"],
  }));
} catch (error) {
  const details = processOutput.length > 0 ? `\n\nProcess output:\n${processOutput.join("")}` : "";
  throw new Error(`${error instanceof Error ? error.stack || error.message : String(error)}${details}`);
} finally {
  cdp?.close();
  await stopProcess(child);
  await rm(testDirectory, { recursive: true, force: true });
}
