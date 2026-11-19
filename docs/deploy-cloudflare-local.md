# Authentication during local Cloudflare deployment

Routine deployment commands preserve an existing Worker's authentication Secrets and session lifetime. Values left in `.env.local`, including instance-scoped values, do not replace them. The deploy runner inspects live versions even when local R2 and username settings are complete; an inspection failure or conflicting live configuration stops deployment before uploading.

Initial credentials still provision a new Worker or a placeholder without authentication. The manual deployment doctor accepts an existing runtime Secret without requiring a locally stored password. An unset live session lifetime stays unset rather than taking a local value.

Intentional changes use separate command-line flags, reading the replacement values from the selected instance's configuration:

- Secret: `EDGE_EVER_INSTANCE=<name> bun run deploy:worker --update-auth-secret`.
- Session lifetime: `EDGE_EVER_INSTANCE=<name> bun run deploy:worker --update-session-ttl`.

A deployed password hash takes precedence over a plaintext password: supply `EDGE_EVER_AUTH_PASSWORD_HASH` (or its instance-scoped equivalent) when replacing an existing hash. Supplying `--secrets-file` to an already authenticated Worker also requires `--update-auth-secret`. Never add replacement flags to routine deployment commands.

`EDGE_EVER_INSTANCE=<name> bun run deploy:worker --dry-run` validates the generated deployment without uploading it. A dry-run never performs a subsequent `secret put`, even with explicit replacement flags.
