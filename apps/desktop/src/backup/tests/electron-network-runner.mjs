import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, net, session, utilityProcess } from "electron";
import { BackupManager } from "../../main/backup-manager.mjs";

const settings = JSON.parse(await readFile(process.argv.at(-1), "utf8"));
app.setPath("userData", join(settings.directory, "electron"));
app.whenReady().then(async () => {
  await session.defaultSession.setProxy(settings.proxy
    ? { mode: "fixed_servers", proxyRules: settings.proxy, proxyBypassRules: "<-loopback>" }
    : { mode: "direct" });
  await session.defaultSession.cookies.set({ url: settings.source, name: "must-not-send", value: "fixture-cookie" });

  const workers = [];
  const factory = settings.baseline ? undefined : (await import("../../main/backup-worker.mjs")).createBackupWorkerFactory({
    utilityProcess, session: session.defaultSession,
  });
  let peakWorkerKiB = 0;
  let peakMainKiB = 0;
  let maxTimerDelayMs = 0;
  let lastSample = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxTimerDelayMs = Math.max(maxTimerDelayMs, now - lastSample - 25); lastSample = now;
    for (const metric of app.getAppMetrics()) {
      if (metric.pid === process.pid) peakMainKiB = Math.max(peakMainKiB, metric.memory.workingSetSize);
      if (workers.some(worker => worker.pid === metric.pid)) peakWorkerKiB = Math.max(peakWorkerKiB, metric.memory.workingSetSize);
    }
  }, 25);
  const manager = new BackupManager({
    userData: join(settings.directory, "state"), defaultDirectory: join(settings.directory, "backups"),
    secureStorage: { isEncryptionAvailable: () => false },
    ...(factory ? { workerFactory(data) {
      const worker = factory(data);
      const exited = new Promise(resolve => worker.once("exit", resolve));
      workers.push({ get pid() { return worker.pid; }, exited });
      return worker;
    } } : {}),
    version: { edgeeverVersion: "2.16.1", buildId: "network-acceptance" },
    onDiagnostic: (event, detail) => console.error(JSON.stringify({ event, ...detail })),
  });
  const context = baseUrl => ({ baseUrl, accountId: "local", token: "fixture-bearer" });
  const checked = () => assert.equal(manager.status().error, null, JSON.stringify(manager.status().error));
  const output = {};
  try {
    await manager.setContext(context(settings.source));
    await manager.save({ ...manager.status().config, enabled: true });
    await manager.tick(); await manager.waitForIdle(); checked();
    const first = manager.status();
    assert.equal(first.lastCheck.result, "success");
    assert.equal(first.config.enabled, true);
    assert.equal(first.config.interval, "weekly");
    assert.equal(first.config.retention, 1);
    output.archiveBytes = first.history[0].size;
    output.archive = join(first.actualDirectory, first.history[0].name);

    // The due check must stay a single state request, not another archive export.
    await manager.tick(Date.parse(first.nextDueAt) + 1); await manager.waitForIdle(); checked();
    assert.equal(manager.status().lastCheck.result, "unchanged");
    assert.equal(manager.status().history.length, 1);

    await manager.setContext(context(settings.target));
    const selection = await manager.selectImport(output.archive);
    const ready = new Promise(resolve => { manager.onChange = status => { if (status?.task?.phase === "ready") resolve(); }; });
    await manager.prepareImport(selection.id); await Promise.race([ready, manager.operation.done]);
    assert.equal(manager.status().importError, null);
    assert.equal(manager.status().task.phase, "ready");
    manager.confirmImport(); await manager.waitForIdle();
    assert.equal(manager.status().importError, null);

    await manager.setContext(context(`${settings.source}/failure`));
    await manager.run(); await manager.waitForIdle();
    assert.equal(manager.status().error.code, "fixture_unavailable");
    assert.equal(manager.status().error.status, 503);

    await manager.setContext(context(`${settings.source}/hang`));
    await manager.run();
    const deadline = Date.now() + 5000;
    while (!(await (await net.fetch(settings.control, { credentials: "omit" })).json()).hanging) {
      assert.ok(Date.now() < deadline, "worker did not begin its request");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await manager.cancel();
    assert.equal(manager.status().task, null);
    assert.equal(manager.status().lastCheck.result, "cancelled");
    await manager.close();
    await Promise.all(workers.map(worker => worker.exited));
    console.log(JSON.stringify({ ...output, workersExited: workers.length, peakWorkerKiB, peakMainKiB, maxTimerDelayMs }));
    app.exit(0);
  } catch (error) {
    console.error(error);
    await manager.close(); app.exit(1);
  } finally { clearInterval(timer); }
}).catch(error => { console.error(error); app.exit(1); });
