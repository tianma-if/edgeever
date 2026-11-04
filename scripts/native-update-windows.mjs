import { spawnSync } from "node:child_process";

export const windowsUpdateInstallerRunning = (name) => {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq $env:UPDATE_INSTALLER_NAME }).Count"], {
    env: { ...process.env, UPDATE_INSTALLER_NAME: name }, encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Cannot inspect the isolated Windows installer process");
  return Number(result.stdout.trim()) !== 0;
};

export const stopWindowsUpdateFixtures = () => {
  // This name belongs only to the isolated CI fixture, never to EdgeEver.exe.
  spawnSync("powershell", ["-NoProfile", "-Command", "Get-Process -Name EdgeEverUpdateVerifier -ErrorAction SilentlyContinue | ForEach-Object { taskkill /PID $_.Id /T /F | Out-Null }"], {
    stdio: "ignore", timeout: 30_000, windowsHide: true,
  });
};
