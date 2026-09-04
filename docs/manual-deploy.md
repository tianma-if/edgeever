# Cloudflare Manual Deployment and Recovery

Use this page for advanced configuration, troubleshooting, and emergency recovery. Most users should use [Deploy EdgeEver online from a Fork](deploy-cloudflare-button.md); AI Agents should use [AI Agent Cloudflare Deployment](agent-deploy-cloudflare.md).

## First manual deployment

1. Fork the repository and clone it locally.
2. Install Node.js 22+ and Bun.
3. Initialize configuration and Cloudflare resources:

   ```sh
   cp .env.local.example .env.local
   bun install
   EDGE_EVER_PASSWORD='<initial password>' bun run deploy:setup
   bun run deploy:doctor
   bun run deploy:manual
   ```

`deploy:setup` creates or reuses D1 and R2 and writes configuration to the git-ignored `.env.local`. `EDGE_EVER_PASSWORD` is required for a new deployment; there is no default production password.

For local CLI deployment, set `EDGE_EVER_DEPLOYMENT_URL=https://<your-worker-domain>` in `.env.local` to include the live `/api/health` request in deployment verification. CI deployments discover the public URL automatically from Wrangler output. Without an explicit URL, local verification still checks the remote D1 schema and Worker Secret, then reports that the live health check was skipped.

After deployment, confirm:

- `/api/health` returns `200` with `"ok": true`
- `/api/openapi.json` is reachable
- `admin` can log in with the password supplied through `EDGE_EVER_PASSWORD`

## Create resources manually

```sh
cp .env.local.example .env.local
bun install
bunx wrangler d1 create edgeever
bunx wrangler r2 bucket create edgeever-resources
```

Write the returned D1 ID and resource names to `.env.local`:

```text
EDGE_EVER_D1_DATABASE_ID=<database_id>
EDGE_EVER_R2_BUCKET_NAME=edgeever-resources
EDGE_EVER_AUTH_USERNAME=admin
EDGE_EVER_AUTH_PASSWORD=<strong password>
EDGE_EVER_SESSION_TTL_DAYS=400
# Optional portable application-level login protection. These also work with Docker + SQLite.
EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS=900
EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS=5
EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS=900
EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS=30
EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS=300
```

Then run:

```sh
bun run deploy:doctor
bun run deploy:manual
```

Do not commit `.env.local` or write passwords to D1.

## Enable third-party OSS settings

Configure an S3-compatible object store from **Settings → Advanced**, then use
**Test connection** before saving it. EdgeEver encrypts the external Secret
Access Key with a purpose-specific key derived from the existing instance
authentication secret before storing it in D1. No additional encryption
variable is required. Keep the instance authentication secret stable and back
it up; changing or losing it makes saved external credentials unusable.

## Recovery

- Database not ready: confirm the D1 binding is `DB`, then run `bun run deploy:manual`.
- Authentication not configured: set `EDGE_EVER_AUTH_PASSWORD` in `.env.local`, then redeploy.
- Forgotten admin password:

  ```sh
  EDGE_EVER_PASSWORD='<new password>' bun run auth:reset-password -- --remote --username admin
  ```

## Automatic updates

After manual deployment, configure [Cloudflare Workers Builds](cloudflare-workers-builds.md) and enable **Update deployed EdgeEver** in the Fork's **Actions**.
