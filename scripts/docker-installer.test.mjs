import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const installerPath = resolve(projectRoot, "apps/site/public/install.sh");
const composePath = resolve(projectRoot, "compose.yaml");
const hostedComposePath = resolve(projectRoot, "apps/site/public/compose.yaml");

function runBash(scriptPath, arguments_, environment) {
  const harnessDirectory = mkdtempSync(resolve(tmpdir(), "edgeever-installer-harness-"));
  const resultPath = resolve(harnessDirectory, "result.json");
  try {
    const harness = spawnSync(
      "node",
      [
        "-e",
        [
          'const { spawnSync } = require("node:child_process");',
          'const { writeFileSync } = require("node:fs");',
          "const result = spawnSync(",
          '  "/bin/bash",',
          "  [process.env.EDGE_EVER_TEST_INSTALLER, ...JSON.parse(process.env.EDGE_EVER_TEST_ARGUMENTS)],",
          '  { encoding: "utf8", env: process.env },',
          ");",
          "writeFileSync(process.env.EDGE_EVER_TEST_RESULT, JSON.stringify({",
          "  status: result.status,",
          "  signal: result.signal,",
          '  stdout: result.stdout || "",',
          '  stderr: result.stderr || "",',
          "  error: result.error?.message,",
          "}));",
        ].join("\n"),
      ],
      {
        env: {
          ...environment,
          EDGE_EVER_TEST_ARGUMENTS: JSON.stringify(arguments_),
          EDGE_EVER_TEST_INSTALLER: scriptPath,
          EDGE_EVER_TEST_RESULT: resultPath,
        },
        encoding: "utf8",
      },
    );
    if (harness.status !== 0) {
      throw new Error(`installer test harness failed: ${harness.stderr}`);
    }
    return JSON.parse(readFileSync(resultPath, "utf8"));
  } finally {
    rmSync(harnessDirectory, { recursive: true, force: true });
  }
}

function runInstaller(arguments_, environment) {
  return runBash(installerPath, arguments_, environment);
}

describe("Docker installer", () => {
  test("publishes the repository Compose file unchanged", async () => {
    expect(await readFile(hostedComposePath, "utf8")).toBe(await readFile(composePath, "utf8"));
  });

  test("installs with TCR and preserves the generated password on rerun", async () => {
    const fixture = await mkdtemp(resolve(tmpdir(), "edgeever-installer-"));
    const fakeBin = resolve(fixture, "bin");
    const installDirectory = resolve(fixture, "edgeever");
    const dockerLog = resolve(fixture, "docker.log");
    const curlLog = resolve(fixture, "curl.log");
    const fakeDocker = resolve(fakeBin, "docker");
    const fakeCurl = resolve(fakeBin, "curl");
    const fakeCrontab = resolve(fakeBin, "crontab");
    const crontabStore = resolve(fixture, "crontab");

    try {
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        fakeDocker,
        `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$EDGE_EVER_TEST_DOCKER_LOG"
if [[ "$1" == "version" ]]; then
  printf '27.5.1\\n'
elif [[ "$1" == "compose" && "$2" == "version" && "\${3:-}" == "--short" ]]; then
  printf '2.32.4\\n'
elif [[ "$1" == "inspect" && "$*" == *".Config.Image"* ]]; then
  printf 'ccr.ccs.tencentyun.com/edgeever/edgeever:latest\\n'
elif [[ "$1" == "inspect" ]]; then
  printf 'healthy\\n'
elif [[ "$1" == "compose" && "$*" == *" ps -q edgeever"* ]]; then
  printf 'edgeever-test-container\\n'
fi
`,
      );
      await writeFile(
        fakeCurl,
        `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$EDGE_EVER_TEST_CURL_LOG"
output=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    output="$2"
    shift 2
  else
    shift
  fi
done
cp "$EDGE_EVER_TEST_COMPOSE_SOURCE" "$output"
`,
      );
      await writeFile(
        fakeCrontab,
        `#!/usr/bin/env bash
set -eu
if [[ "\${1:-}" == "-l" ]]; then
  if [[ -f "$EDGE_EVER_TEST_CRONTAB" ]]; then
    cat "$EDGE_EVER_TEST_CRONTAB"
  else
    exit 1
  fi
else
  cp "$1" "$EDGE_EVER_TEST_CRONTAB"
fi
`,
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeCurl, 0o755);
      await chmod(fakeCrontab, 0o755);

      const environment = {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        EDGE_EVER_INSTALL_DIR: installDirectory,
        EDGE_EVER_TEST_COMPOSE_SOURCE: composePath,
        EDGE_EVER_TEST_CRONTAB: crontabStore,
        EDGE_EVER_TEST_CURL_LOG: curlLog,
        EDGE_EVER_TEST_DOCKER_LOG: dockerLog,
      };
      const first = runInstaller(["--mirror", "tcr", "--port", "18789"], environment);
      if (first.status !== 0) {
        const commands = await readFile(dockerLog, "utf8").catch(() => "no Docker commands");
        throw new Error(
          `installer failed (exit=${first.status}, signal=${first.signal}):\n${first.stdout}\n${first.stderr}\n${commands}`,
        );
      }
      expect(first.status).toBe(0);

      const firstEnvironment = await readFile(resolve(installDirectory, ".env"), "utf8");
      expect(firstEnvironment).toContain(
        "EDGE_EVER_IMAGE='ccr.ccs.tencentyun.com/edgeever/edgeever'",
      );
      expect(firstEnvironment).toContain("EDGE_EVER_VERSION='latest'");
      expect(firstEnvironment).toContain("EDGE_EVER_PORT='18789'");
      expect(firstEnvironment).toMatch(/EDGE_EVER_AUTH_PASSWORD='[a-f0-9]{32}'/);
      const generatedPassword = firstEnvironment.match(
        /EDGE_EVER_AUTH_PASSWORD='([a-f0-9]{32})'/,
      )?.[1];
      if (!generatedPassword) {
        throw new Error("installer did not generate a password");
      }
      expect(first.stderr).toContain("[STEP 1/6] Validate environment");
      expect(first.stderr).toContain("[STEP 6/6] Wait for health check");
      expect(first.stderr).toContain("[SUCCESS] EdgeEver is ready");
      expect(first.stderr).toContain("Host OS:");
      expect(first.stderr).toContain("Kernel:");
      expect(first.stderr).toContain("Architecture:");
      expect(first.stderr).toContain("Docker Engine: 27.5.1");
      expect(first.stderr).toContain("Docker Compose: 2.32.4");
      expect(first.stderr).toContain(
        "EdgeEver target: ccr.ccs.tencentyun.com/edgeever/edgeever:latest",
      );
      expect(first.stderr).toContain(
        "Running image: ccr.ccs.tencentyun.com/edgeever/edgeever:latest",
      );
      expect(first.stderr).not.toContain(generatedPassword);
      expect(first.stdout).toContain(`Password: ${generatedPassword}`);
      expect(first.stdout).toContain("docker compose logs --tail 200 -f edgeever");
      expect(first.stdout).toContain("Automatic updates: daily at 04:17 server time");

      const second = runInstaller([], environment);
      if (second.status !== 0) {
        throw new Error(
          `installer rerun failed (exit=${second.status}, signal=${second.signal}):\n${second.stdout}\n${second.stderr}`,
        );
      }
      expect(second.status).toBe(0);
      expect(await readFile(resolve(installDirectory, ".env"), "utf8")).toBe(firstEnvironment);

      const updaterSource = await readFile(resolve(installDirectory, "update.sh"), "utf8");
      expect(updaterSource).toContain("Checking for updates");
      expect(updaterSource).toContain("Update complete. Running image:");
      expect(updaterSource).toContain("Persistent storage diagnostics:");
      expect(updaterSource).toContain("/data write test: failed.");
      expect(updaterSource).not.toContain(generatedPassword);
      const installedCrontab = await readFile(crontabStore, "utf8");
      expect(installedCrontab).toContain("17 4 * * *");
      expect(installedCrontab).toContain("edgeever-auto-update:edgeever");
      expect(installedCrontab.match(/edgeever-auto-update:edgeever/g)).toHaveLength(1);

      const update = runBash(resolve(installDirectory, "update.sh"), [], environment);
      expect(update.status).toBe(0);
      expect(update.stdout).toContain("Checking for updates.");
      expect(update.stdout).toContain(
        "Update complete. Running image: ccr.ccs.tencentyun.com/edgeever/edgeever:latest.",
      );

      const disabled = runInstaller(["--no-auto-update"], environment);
      expect(disabled.status).toBe(0);
      expect(disabled.stdout).toContain("Automatic updates: disabled");
      expect(
        await readFile(resolve(installDirectory, "update.sh"), "utf8").then(
          () => true,
          () => false,
        ),
      ).toBe(false);
      expect(await readFile(crontabStore, "utf8")).not.toContain("edgeever-auto-update:edgeever");

      const log = await readFile(dockerLog, "utf8");
      expect(log).toContain("compose version");
      expect(log.match(/ pull$/gm)).toHaveLength(4);
      expect(log.match(/ up -d --remove-orphans$/gm)).toHaveLength(4);
      expect(log).toContain("inspect --format");
      const curlRequests = await readFile(curlLog, "utf8");
      expect(
        curlRequests.match(
          /edgeever-installer-1256854452\.cos\.ap-guangzhou\.myqcloud\.com\/compose\.yaml/g,
        ),
      ).toHaveLength(4);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("prints actionable diagnostics without exposing the password", async () => {
    const fixture = await mkdtemp(resolve(tmpdir(), "edgeever-installer-failure-"));
    const fakeBin = resolve(fixture, "bin");
    const installDirectory = resolve(fixture, "edgeever");
    const fakeDocker = resolve(fakeBin, "docker");
    const fakeCurl = resolve(fakeBin, "curl");
    const secret = "installer-secret-must-stay-hidden";

    try {
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        fakeDocker,
        `#!/usr/bin/env bash
set -eu
if [[ "$*" == *" pull" ]]; then
  printf 'mock pull failure\n' >&2
  exit 42
elif [[ "$*" == *" ps -a" ]]; then
  printf 'mock container status\n'
elif [[ "$*" == *" logs --tail 80 edgeever" ]]; then
  printf 'mock recent logs\n'
fi
`,
      );
      await writeFile(
        fakeCurl,
        `#!/usr/bin/env bash
set -eu
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    cp "$EDGE_EVER_TEST_COMPOSE_SOURCE" "$2"
    exit 0
  fi
  shift
done
exit 1
`,
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeCurl, 0o755);

      const result = runInstaller(
        [],
        {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          EDGE_EVER_AUTH_PASSWORD: secret,
          EDGE_EVER_INSTALL_DIR: installDirectory,
          EDGE_EVER_TEST_COMPOSE_SOURCE: composePath,
        },
      );

      expect(result.status).toBe(42);
      expect(result.stderr).toContain("A command failed (exit code: 42");
      expect(result.stderr).toContain("Stage: Pull image and start container");
      expect(result.stderr).toContain("Container status:");
      expect(result.stderr).toContain("mock container status");
      expect(result.stderr).toContain("Recent container logs:");
      expect(result.stderr).toContain("mock recent logs");
      expect(result.stderr).toContain("Troubleshooting commands:");
      expect(result.stderr).toContain("docs/deploy-docker.md");
      expect(result.stderr).not.toContain(secret);
      expect(result.stdout).not.toContain(secret);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test("identifies a NAS bind-mount permission failure and prints a targeted repair", async () => {
    const fixture = await mkdtemp(resolve(tmpdir(), "edgeever-installer-permission-"));
    const fakeBin = resolve(fixture, "bin");
    const installDirectory = resolve(fixture, "edgeever");
    const nasDataDirectory = "/volume1/docker/edgeever data";
    const fakeDocker = resolve(fakeBin, "docker");
    const fakeCurl = resolve(fakeBin, "curl");

    try {
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        fakeDocker,
        `#!/usr/bin/env bash
set -eu
if [[ "$1" == "version" ]]; then
  printf '27.5.1\\n'
elif [[ "$1" == "compose" && "$2" == "version" && "\${3:-}" == "--short" ]]; then
  printf '2.32.4\\n'
elif [[ "$1" == "compose" && "$*" == *" ps -q edgeever"* ]]; then
  printf 'edgeever-permission-container\\n'
elif [[ "$1" == "inspect" && "$*" == *".Config.User"* ]]; then
  printf 'bun\\n'
elif [[ "$1" == "inspect" && "$*" == *".Mounts"* ]]; then
  printf 'bind||${nasDataDirectory}\\n'
elif [[ "$1" == "inspect" ]]; then
  printf 'exited\\n'
elif [[ "$1" == "compose" && "$*" == *" run --rm --no-deps --entrypoint /bin/sh edgeever"* ]]; then
  printf '/bin/sh: cannot create /data/.edgeever-write-test: Permission denied\\n' >&2
  printf 'EDGEEVER_DATA_WRITE_FAILED\\n' >&2
  printf 'Runtime identity: uid=1000(bun) gid=1000(bun)\\n' >&2
  printf 'Data directory: drwxr-xr-x 2 0 0 4096 /data\\n' >&2
  exit 73
elif [[ "$1" == "compose" && "$*" == *" logs --tail 80 edgeever"* ]]; then
  printf 'SQLITE_CANTOPEN: unable to open database file\\n'
fi
`,
      );
      await writeFile(
        fakeCurl,
        `#!/usr/bin/env bash
set -eu
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then
    cp "$EDGE_EVER_TEST_COMPOSE_SOURCE" "$2"
    exit 0
  fi
  shift
done
exit 1
`,
      );
      await chmod(fakeDocker, 0o755);
      await chmod(fakeCurl, 0o755);

      const result = runInstaller(
        ["--no-auto-update"],
        {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          EDGE_EVER_INSTALL_DIR: installDirectory,
          EDGE_EVER_TEST_COMPOSE_SOURCE: composePath,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Persistent storage diagnostics:");
      expect(result.stderr).toContain("Container user: bun (EdgeEver expects UID/GID 1000:1000)");
      expect(result.stderr).toContain(`/data mount: type=bind, source=${nasDataDirectory}`);
      expect(result.stderr).toContain("/data write test: failed");
      expect(result.stderr).toContain("Permission denied");
      expect(result.stderr).toContain("Runtime identity: uid=1000(bun) gid=1000(bun)");
      expect(result.stderr).toContain("The NAS/host directory must be writable by UID/GID 1000:1000");
      expect(result.stderr).toContain("sudo chown -R 1000:1000 -- /volume1/docker/edgeever\\ data");
      expect(result.stderr).toContain("NAS uses ACL permissions");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
