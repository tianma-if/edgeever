# Cloudflare Workers Builds

## Setup

For a manual repository import, keep Cloudflare's default `npx wrangler deploy` command as described in the [online deployment guide](deploy-cloudflare-button.md), with root directory `/` and production branch `main`. The repository-provided Wrangler compatibility entrypoint routes that default command through the complete EdgeEver deployment pipeline. Existing projects using the explicit build and `bun run deploy:cloudflare-builds` commands remain supported.

Authorization:

1. Approve the **Cloudflare Workers & Pages** GitHub App for the deployment repository.
2. If the Agent integration needs a Cloudflare API token, use a User API Token limited to the target account.
3. Configure the deployment API token in Cloudflare under **Worker -> Settings -> Builds -> API token**.

Configure `EDGE_EVER_AUTH_PASSWORD` under the Worker's **Settings -> Variables and Secrets** as a runtime Secret; do not copy the password into Builds variables. `deploy:cloudflare-builds` reuses that Secret and verifies its presence after deployment.

Keep the tracked `wrangler.toml` unchanged. Ordinary deployments use D1 `edgeever`, R2 `edgeever-resources`, and username `admin`. Optional non-secret instance settings such as `EDGE_EVER_AUTH_USERNAME`, `EDGE_EVER_WORKER_NAME`, `EDGE_EVER_D1_DATABASE_NAME`, `EDGE_EVER_R2_BUCKET_NAME`, and custom routing belong under **Settings -> Builds -> Variables and secrets**. Workers Builds variables are available to the build command, not to the running Worker; the deploy command uses them to generate a temporary Wrangler configuration. Passwords and credentials remain runtime Secrets.

Backward compatibility is automatic: without explicit R2 or username Builds variables, an upgrade inspects the active production Worker versions and preserves their existing `RESOURCES` bucket and administrator username. A brand-new Worker uses the standard defaults.

## Updates and troubleshooting

- A push to `main` builds, applies D1 migrations, deploys, and verifies EdgeEver.
- **Update deployed EdgeEver** keeps a deployment Fork as an upstream **deploy mirror**:
  - Default channel `stable` tracks the latest formal Release tag.
  - Set the GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` to follow upstream `main`.
  - Read-only forks (no app code changes) apply the target's product snapshot in a new linear commit without installing dependencies or running the project test suite.
  - Only forks that explicitly set `EDGE_EVER_PRESERVE_FORK_CHANGES=true` merge product changes. A customized merge runs local migrations, the complete non-E2E test suite, type checks, and the production build before pushing; any failure leaves `main` and production unchanged.
  - Formal Releases run the same complete non-E2E suite on an official Ubuntu job before Draft assets are prepared. This keeps the stable channel's upstream baseline green, so customized-fork failures indicate an integration problem rather than a test already broken by the Release itself.
  - The complete downstream `.github/workflows/**` directory and two updater helper scripts form a stable local bootstrap layer. Official packaging, signing, testing, and Release workflows are not part of automatic product updates, so `GITHUB_TOKEN` never needs permission to rewrite Actions workflows.
  - Every run writes a bilingual job **Summary** that separates the Fork's Git state, the deployment trigger, and live-deployment verification. A green scheduled run that says *Already on upstream target* means no deployment was requested; a successful push means deployment was requested but still must be confirmed in Cloudflare.
  - Prefer this workflow over GitHub **Sync fork**. Sync fork follows upstream `main` history and can make the next stable run a deliberate no-op.
- Optional: repository secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL` triggers a Cloudflare Deploy Hook after a successful push (useful when the Git integration misses a push).
- Manually running the workflow redeploys the selected version even when Git is already current: it pushes an empty commit so Cloudflare receives a fresh build event. Scheduled checks remain no-op when already aligned.
- Build failure: inspect the Worker **Deployments** log and confirm the Deployment commit SHA matches Fork `main`.
- Scheduled update never runs: on a public Fork, enable **Update deployed EdgeEver** under **Actions** (scheduled workflows are disabled by default on forks, and may pause after long inactivity).
- Update push is rejected with `without workflows permission`: the Fork still has an older updater. Use GitHub **Sync fork** once with the repository owner's permission, then re-run **Update deployed EdgeEver**. Routine product updates do not require **Sync fork** after that bootstrap.
