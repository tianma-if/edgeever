# Cloudflare Workers Builds

## Setup

For first-time setup, create the `edgeever` Worker with **Start with Hello World!**, deploy `EDGE_EVER_AUTH_PASSWORD` as a runtime Secret, then connect the Fork through the existing Worker’s **Settings → Builds → Connect**. Follow the [online deployment guide](deploy-cloudflare-button.md), use the repository root and `main` branch, and keep the default `npx wrangler deploy` command. Existing projects can keep their explicit build and `bun run deploy:cloudflare-builds` commands.

Authorization:

1. Approve the **Cloudflare Workers & Pages** GitHub App for the deployment repository.
2. If the Agent integration needs a Cloudflare API token, use a User API Token limited to the target account.
3. Configure the deployment API token in Cloudflare under **Worker -> Settings -> Build -> API token**. The automatically generated token may lack D1 permissions; confirm it has D1 read and edit permissions for the target account before deploying. Select this token in the Worker’s **Settings → Builds → API token** and save the build settings. Subsequent Cloudflare Workers Builds runs use it for database migrations and Worker deployment.

Set `EDGE_EVER_AUTH_PASSWORD` as a runtime Secret under the Worker's **Settings → Variables and Secrets**, not as a Builds variable.

Ordinary deployments use D1 `edgeever`, R2 `edgeever-resources`, and username `admin`. Put optional non-secret instance settings under **Settings → Build → Build variables and secrets**. These variables are available only during the build; the deploy command uses them to generate a temporary Wrangler configuration. Keep the tracked `wrangler.toml` unchanged.

Without an explicit override, existing deployments keep their current R2 bucket and administrator username.

## Updates and troubleshooting

- A push to `main` builds, applies D1 migrations, deploys, and verifies EdgeEver.
- **Update deployed EdgeEver** keeps a deployment Fork as an upstream **deploy mirror**:
  - Default channel `stable` tracks the latest formal Release tag.
  - Set the GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` to follow upstream `main`.
  - Read-only forks (no app code changes) apply the target's product snapshot in a new linear commit without installing dependencies or running the project test suite.
  - Only forks that explicitly set `EDGE_EVER_PRESERVE_FORK_CHANGES=true` merge product changes. A customized merge runs local migrations, the complete non-E2E test suite, type checks, and the production build before pushing; any failure leaves `main` and production unchanged.
  - Updates preserve the Fork's `.github/workflows/**` and updater helper scripts; `GITHUB_TOKEN` needs no permission to rewrite Actions workflows.
  - The job **Summary** shows Git and deployment status. *Already on upstream target* means a scheduled run requested no deployment; a successful push still needs confirmation in Cloudflare.
  - Prefer this workflow over GitHub **Sync fork**. Sync fork follows upstream `main` history and can make the next stable run a deliberate no-op.
- Optional: repository secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL` triggers a Cloudflare Deploy Hook after a successful push (useful when the Git integration misses a push).
- Manually running the workflow triggers a new Cloudflare build even when Git is current.
- Build failure: inspect the Worker **Deployments** log and confirm the Deployment commit SHA matches Fork `main`.
- Scheduled update never runs: on a public Fork, enable **Update deployed EdgeEver** under **Actions** (scheduled workflows are disabled by default on forks, and may pause after long inactivity).
- Update push is rejected with `without workflows permission`: the Fork still has an older updater. Use GitHub **Sync fork** once with the repository owner's permission, then re-run **Update deployed EdgeEver**. Routine product updates do not require **Sync fork** after that bootstrap.
