# Restore clean Demo data in local DEV

Run from the repository:

```sh
bun run dev:reset
```

This replaces the notes, notebooks, attachments, revision history, search documents and API tokens in `.wrangler/state` with the repository's current Demo seed. It preserves accounts, login sessions and AI provider/model settings. Refresh the Web page afterwards; the changed workspace sync identity makes it reload the clean snapshot. Existing API tokens must be recreated.

The command works with local DEV running or stopped. Start stopped Web/API services with `bun run dev`. It does not switch DEV into authentication-free Demo mode, change `.env.local`, deploy, or reset the public Demo. No backup is created automatically; export important notes before running it. Do not edit notes or run write tests during the reset.

The script uses Wrangler's local D1/R2 bindings without opening a server. The target is fixed to this checkout's `.wrangler/state`; arguments, remote bindings, symlinked state and external object-storage configurations are rejected. It checks the database identity before writing and verifies the restored note/notebook IDs against the seed afterwards. Existing Demo reset locking and cooldown apply; if asked to wait, rerun after the cooldown. After an interrupted reset, fix the reported problem and rerun. Remove `.wrangler/local-demo-reset.lock` only after confirming no reset process remains.

`bun run dev:demo:reset` continues to target the separate local Demo profile. `bun run demo:sync` deploys and resets the **public** Demo and is not a substitute for this command.

Regression checks:

```sh
bun test scripts/reset-local-demo.test.mjs scripts/local-dev.test.mjs
```
