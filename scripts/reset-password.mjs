import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPasswordHash } from "./password-hash.mjs";

const usage = `Usage:
  EDGE_EVER_PASSWORD='<new-password>' bun run auth:reset-password -- --remote --username <username>
  EDGE_EVER_PASSWORD='<new-password>' bun run auth:reset-password -- --local --username <username>

For a scoped instance, also set EDGE_EVER_INSTANCE, for example EDGE_EVER_INSTANCE=demo.`;

export const parseResetPasswordArgs = (args) => {
  let target;
  let username;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--remote" || arg === "--local") {
      const nextTarget = arg.slice(2);
      if (target && target !== nextTarget) {
        throw new Error("Choose exactly one of --remote or --local.");
      }
      target = nextTarget;
      continue;
    }

    if (arg === "--username") {
      username = args[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!target) {
    throw new Error("Choose --remote or --local.");
  }

  if (!username?.trim()) {
    throw new Error("Provide --username <username>.");
  }

  return { target, username: username.trim() };
};

const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

export const buildUserLookupSql = (username) =>
  `SELECT id FROM users WHERE username = ${sqlString(username)} AND is_disabled = 0 LIMIT 1`;

export const buildPasswordHashLookupSql = (username) =>
  `SELECT password_hash FROM users WHERE username = ${sqlString(username)} AND is_disabled = 0 LIMIT 1`;

export const buildTotpStatusSql = (username) =>
  `SELECT enabled_at FROM user_totp WHERE user_id = (
  SELECT id FROM users WHERE username = ${sqlString(username)} AND is_disabled = 0 LIMIT 1
) AND enabled_at IS NOT NULL LIMIT 1`;

// Mirrors MFA_PASSWORD_HASH_ALGORITHM in apps/api/src/auth-crypto.ts: an account
// with TOTP enabled keeps its hash under the "-mfa" tag so a backend that predates
// TOTP fails closed for it after a rollback. A reset must not drop that tag.
const PLAIN_HASH_ALGORITHM = "pbkdf2-sha256";
const MFA_HASH_ALGORITHM = "pbkdf2-sha256-mfa";

export const passwordHashForReset = (passwordHash, totpEnabled) =>
  totpEnabled && passwordHash.startsWith(`${PLAIN_HASH_ALGORITHM}$`)
    ? `${MFA_HASH_ALGORITHM}${passwordHash.slice(PLAIN_HASH_ALGORITHM.length)}`
    : passwordHash;

export const buildPasswordResetSql = (username, passwordHash) => {
  const escapedUsername = sqlString(username);
  const escapedHash = sqlString(passwordHash);

  return `UPDATE users
SET password_hash = ${escapedHash}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE username = ${escapedUsername} AND is_disabled = 0;
UPDATE sessions
SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id IN (
  SELECT id FROM users WHERE username = ${escapedUsername} AND is_disabled = 0
) AND revoked_at IS NULL;
`;
};

export const parseD1Rows = (output) => {
  const parsed = JSON.parse(output);
  const results = Array.isArray(parsed) ? parsed : [parsed];
  return results.flatMap((result) => result?.results ?? []);
};

const runWrangler = (args) => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/run-wrangler.mjs"), ...args],
    { encoding: "utf8", env: process.env },
  );

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Wrangler exited with status ${result.status ?? 1}.`);
  }

  return result.stdout;
};

const main = () => {
  let options;
  try {
    options = parseResetPasswordArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exit(1);
  }

  const password = process.env.EDGE_EVER_PASSWORD;
  if (!password || password.length < 8 || password.length > 512) {
    console.error("EDGE_EVER_PASSWORD must contain 8-512 characters.");
    console.error(usage);
    process.exit(1);
  }

  const targetFlag = `--${options.target}`;
  const lookupOutput = runWrangler([
    "d1",
    "execute",
    "DB",
    targetFlag,
    "--command",
    buildUserLookupSql(options.username),
    "--json",
  ]);

  if (parseD1Rows(lookupOutput).length === 0) {
    throw new Error(`Enabled user not found: ${options.username}`);
  }

  // Keep the TOTP tag on the new hash. The table does not exist on a database
  // that has not run migration 0088 yet; treat that as "not enabled".
  let totpEnabled = false;
  try {
    totpEnabled = parseD1Rows(runWrangler([
      "d1",
      "execute",
      "DB",
      targetFlag,
      "--command",
      buildTotpStatusSql(options.username),
      "--json",
    ])).length > 0;
  } catch {
    totpEnabled = false;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "edgeever-password-reset-"));
  const sqlPath = join(temporaryDirectory, "reset-password.sql");

  try {
    const passwordHash = passwordHashForReset(createPasswordHash(password), totpEnabled);
    writeFileSync(sqlPath, buildPasswordResetSql(options.username, passwordHash), {
      mode: 0o600,
    });
    runWrangler(["d1", "execute", "DB", targetFlag, "--file", sqlPath, "--yes"]);

    const verificationOutput = runWrangler([
      "d1",
      "execute",
      "DB",
      targetFlag,
      "--command",
      buildPasswordHashLookupSql(options.username),
      "--json",
    ]);
    const [updatedUser] = parseD1Rows(verificationOutput);
    if (updatedUser?.password_hash !== passwordHash) {
      throw new Error(`Password reset verification failed: ${options.username}`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(
    `Password reset for ${options.username} (${options.target}); existing sessions revoked.`
    + (totpEnabled ? " Two-factor authentication stays enabled." : ""),
  );
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
