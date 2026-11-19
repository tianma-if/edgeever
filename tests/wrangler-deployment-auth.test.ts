import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const runner = resolve(import.meta.dir, "../scripts/run-wrangler.mjs");
const systemEnv = Object.fromEntries(
  ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP"]
    .flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []),
);
const fixture = (options: { missing?: boolean; noSecret?: boolean; noTtl?: boolean; inspectFailure?: boolean; conflictingTtl?: boolean; conflictingSecret?: boolean } = {}) => {
  const cwd = mkdtempSync(resolve(tmpdir(), "edgeever-auth-deploy-"));
  const cli = resolve(cwd, "node_modules/wrangler/bin");
  mkdirSync(cli, { recursive: true });
  const config = resolve(cwd, "external.toml");
  writeFileSync(config, 'name = "fixture"\ndatabase_id = "11111111-1111-1111-1111-111111111111"\nbucket_name = "resources"\npreview_bucket_name = "preview"\n');
  const bindings = [
    { name: "RESOURCES", type: "r2_bucket", bucket_name: "resources" },
    { name: "EDGE_EVER_AUTH_USERNAME", type: "plain_text", text: "owner" },
    ...(!options.noTtl ? [{ name: "EDGE_EVER_SESSION_TTL_DAYS", type: "plain_text", text: "30" }] : []),
    ...(!options.noSecret ? [{ name: "EDGE_EVER_AUTH_PASSWORD_HASH", type: "secret_text" }] : []),
  ];
  writeFileSync(resolve(cwd, "state.json"), JSON.stringify({ bindings, secret: options.noSecret ? undefined : "original-live-hash" }));
  writeFileSync(resolve(cwd, "options.json"), JSON.stringify(options));
  // Simulates the Cloudflare CLI boundary, including persistent state across deployments.
  writeFileSync(resolve(cli, "wrangler.js"), `
const fs = require('node:fs');
const args = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync('options.json', 'utf8'));
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args.includes('deployments')) {
  if (options.inspectFailure) { console.error('permission denied'); process.exit(1); }
  if (options.missing) { console.error('Worker does not exist [code: 10007]'); process.exit(1); }
  console.log(JSON.stringify({ versions: [{ version_id: 'old-version', percentage: 100 }, ...((options.conflictingTtl || options.conflictingSecret) ? [{ version_id: 'other-version', percentage: 10 }] : [])] }));
} else if (args.includes('versions')) {
  if (args.includes('other-version') && options.conflictingTtl) state.bindings = state.bindings.filter(b => b.name !== 'EDGE_EVER_SESSION_TTL_DAYS');
  if (args.includes('other-version') && options.conflictingSecret) state.bindings = state.bindings.map(b => b.name === 'EDGE_EVER_AUTH_PASSWORD_HASH' ? { ...b, name: 'EDGE_EVER_AUTH_PASSWORD' } : b);
  console.log(JSON.stringify({ resources: { bindings: state.bindings } }));
} else if (args.includes('deploy')) {
  const config = fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8');
  fs.writeFileSync('sent-config.toml', config);
  if (!args.includes('--dry-run')) {
    const ttl = config.match(/^EDGE_EVER_SESSION_TTL_DAYS = "([^"]*)"/m)?.[1];
    state.bindings = state.bindings.filter(b => b.name !== 'EDGE_EVER_SESSION_TTL_DAYS');
    if (ttl) state.bindings.push({ name: 'EDGE_EVER_SESSION_TTL_DAYS', type: 'plain_text', text: ttl });
    if (args.includes('--secrets-file')) {
      state.secret = Object.values(JSON.parse(fs.readFileSync(args[args.indexOf('--secrets-file') + 1], 'utf8')))[0];
      fs.writeFileSync('uploaded-secret', state.secret);
    }
    fs.writeFileSync('state.json', JSON.stringify(state));
  }
} else if (args.includes('secret') && args.includes('list')) {
  if (args[args.indexOf('--name') + 1] !== 'fixture') process.exit(1);
  console.log(JSON.stringify(state.bindings.filter(b => b.type === 'secret_text')));
} else if (args.includes('secret')) {
  fs.writeFileSync('secret-put', fs.readFileSync(0, 'utf8'));
}
`);
  const localEnv = (credentials = true, sessionTtl: string | null = "1825") => writeFileSync(resolve(cwd, ".env.local"), [
    "EDGE_EVER_INSTANCE=demo",
    "EDGE_EVER_DEMO_WORKER_NAME=fixture",
    "EDGE_EVER_DEMO_D1_DATABASE_ID=11111111-1111-1111-1111-111111111111",
    "EDGE_EVER_DEMO_AUTH_USERNAME=owner",
    "EDGE_EVER_DEMO_R2_BUCKET_NAME=resources",
    ...(sessionTtl === null ? [] : [`EDGE_EVER_DEMO_SESSION_TTL_DAYS=${sessionTtl}`]),
    ...(credentials ? ["EDGE_EVER_DEMO_AUTH_PASSWORD_HASH=stale-local-hash"] : []),
  ].join("\n"));
  localEnv();
  const run = (...args: string[]) => spawnSync(process.execPath, [runner, "deploy", ...args], {
    cwd, encoding: "utf8", env: { ...systemEnv, WRANGLER_CONFIG: config },
  });
  return {
    run, localEnv,
    doctor: () => spawnSync(process.execPath, [resolve(import.meta.dir, "../scripts/cloudflare-deploy.mjs"), "doctor"], {
      cwd, encoding: "utf8", env: { ...systemEnv, WRANGLER_CONFIG: config },
    }),
    read: (name: string) => readFileSync(resolve(cwd, name), "utf8"),
    state: () => JSON.parse(readFileSync(resolve(cwd, "state.json"), "utf8")),
    calls: () => readFileSync(resolve(cwd, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
};

test("redeploys an existing Worker without replacing its Secret or session lifetime from stale local configuration", () => {
  const f = fixture();
  try {
    const first = f.run();
    expect(first.status).toBe(0);
    expect(f.state().secret).toBe("original-live-hash");
    expect(f.read("sent-config.toml")).toContain('EDGE_EVER_SESSION_TTL_DAYS = "30"');
    expect(f.calls().some((args) => args.includes("deployments"))).toBe(true);
    expect(f.calls().some((args) => args.includes("--secrets-file") || args.includes("secret"))).toBe(false);
    expect(first.stdout + first.stderr).not.toContain("stale-local-hash");
    // A later deployment also works without keeping any credentials on the machine.
    f.localEnv(false);
    expect(f.run().status).toBe(0);
    expect(f.state().secret).toBe("original-live-hash");
    expect(f.read("sent-config.toml")).toContain('EDGE_EVER_SESSION_TTL_DAYS = "30"');
  } finally { f.cleanup(); }
});

test("preserves an unset live session lifetime instead of introducing a local value", () => {
  const f = fixture({ noTtl: true });
  try {
    expect(f.run().status).toBe(0);
    expect(f.read("sent-config.toml")).not.toContain("EDGE_EVER_SESSION_TTL_DAYS");
  } finally { f.cleanup(); }
});

test("Secret replacement requires an explicit flag and preserves the session lifetime", () => {
  const f = fixture();
  try {
    expect(f.run("--update-auth-secret").status).toBe(0);
    expect(f.state().secret).toBe("stale-local-hash");
    expect(f.read("sent-config.toml")).toContain('EDGE_EVER_SESSION_TTL_DAYS = "30"');
    expect(f.calls().some((args) => args.includes("--update-auth-secret"))).toBe(false);
  } finally { f.cleanup(); }
});

test("session lifetime replacement requires its own flag and never uploads credentials", () => {
  const f = fixture();
  try {
    expect(f.run("--update-session-ttl").status).toBe(0);
    expect(f.state().secret).toBe("original-live-hash");
    expect(f.read("sent-config.toml")).toContain('EDGE_EVER_SESSION_TTL_DAYS = "1825"');
    expect(f.calls().some((args) => args.includes("--secrets-file") || args.includes("secret"))).toBe(false);
  } finally { f.cleanup(); }
});

test("dry-run never writes a Secret, even with explicit replacement flags", () => {
  const f = fixture();
  try {
    expect(f.run("--dry-run", "--update-auth-secret", "--update-session-ttl").status).toBe(0);
    expect(f.state().secret).toBe("original-live-hash");
    expect(f.state().bindings.find((b: { name: string }) => b.name === "EDGE_EVER_SESSION_TTL_DAYS").text).toBe("30");
    expect(f.calls().some((args) => args.includes("secret"))).toBe(false);
  } finally { f.cleanup(); }
});

for (const options of [{ missing: true }, { noSecret: true }, { noSecret: true, noTtl: true }]) {
  test(`initial credentials still bootstrap a Worker: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    try {
      expect(f.run().status).toBe(0);
      expect(f.state().secret).toBe("stale-local-hash");
      expect(f.read("sent-config.toml")).toContain(`EDGE_EVER_SESSION_TTL_DAYS = "${options.missing || ("noTtl" in options && options.noTtl) ? "1825" : "30"}"`);
    } finally { f.cleanup(); }
  });
}

for (const options of [{ inspectFailure: true }, { conflictingTtl: true }, { conflictingSecret: true }]) {
  test(`cannot deploy when live configuration cannot safely be inherited: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    try {
      expect(f.run().status).not.toBe(0);
      expect(f.calls().some((args) => args.includes("deploy") || args.includes("secret"))).toBe(false);
    } finally { f.cleanup(); }
  });
}

test("missing local and live credentials cannot bypass authentication setup", () => {
  const f = fixture({ noSecret: true });
  try {
    f.localEnv(false);
    expect(f.run().status).not.toBe(0);
    expect(f.calls().some((args) => args.includes("deploy"))).toBe(false);
  } finally { f.cleanup(); }
});


test("manual deployment doctor accepts an existing runtime Secret without local credentials", () => {
  const f = fixture();
  try {
    f.localEnv(false);
    const result = f.doctor();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("existing Worker Secret will be preserved");
    expect(f.state().secret).toBe("original-live-hash");
  } finally { f.cleanup(); }
});


for (const flag of ["--update-auth-secret", "--update-session-ttl"]) {
  test(`${flag} requires an explicitly configured replacement value`, () => {
    const f = fixture();
    try {
      f.localEnv(false, null);
      expect(f.run(flag).status).not.toBe(0);
      expect(f.calls().some((args) => args.includes("deploy") || args.includes("secret"))).toBe(false);
    } finally { f.cleanup(); }
  });
}

test("a supplied secrets file cannot bypass default Secret preservation", () => {
  const f = fixture();
  try {
    const result = f.run("--secrets-file", "old-secrets.json");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--update-auth-secret explicitly");
    expect(f.calls().some((args) => args.includes("deploy") || args.includes("secret"))).toBe(false);
  } finally { f.cleanup(); }
});
