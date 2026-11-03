// Read the public desktop bridge through the fixture's loopback main debugger.
// No renderer/account state is changed; this is used only to diagnose a failure.
export const readNativeUpdateStatus = async (endpoint) => {
  if (!endpoint) return null;
  const socket = new WebSocket(endpoint);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture debugger connection timed out")), 5_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Fixture debugger unavailable")); }, { once: true });
    });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture status query timed out")), 5_000);
      socket.addEventListener("message", ({ data }) => {
        const response = JSON.parse(String(data));
        if (response.id !== 1) return;
        clearTimeout(timer);
        resolve(response.result?.result?.value ?? response.error ?? response.result?.exceptionDetails);
      });
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { awaitPromise: true, returnByValue: true,
        expression: `(async () => {
          const req = process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json');
          const window = req('electron').BrowserWindow.getAllWindows().find(value => value.webContents.getURL().startsWith('edgeever-app://app/'));
          return window ? await window.webContents.executeJavaScript('window.edgeeverDesktop.updateStatus()') : {error: 'fixture window unavailable'};
        })()`,
      } }));
    });
    return result;
  } finally { socket.close(); }
};
