# Cloudflare Workers Builds

## Setup

Use the build and deploy commands from the [online deployment guide](deploy-cloudflare-button.md), with root directory `/` and production branch `main`.

Authorization:

1. Approve the **Cloudflare Workers & Pages** GitHub App for the deployment repository.
2. If the Agent integration needs a Cloudflare API token, use a User API Token limited to the target account.
3. Configure the deployment API token in Cloudflare under **Worker -> Settings -> Builds -> API token**.

Configure `EDGE_EVER_AUTH_PASSWORD` under the Worker's **Settings -> Variables and Secrets** as a runtime Secret; do not copy the password into Builds variables. `deploy:cloudflare-builds` reuses that Secret and verifies its presence after deployment.

## Updates and troubleshooting

- A push to `main` builds, applies D1 migrations, deploys, and verifies EdgeEver.
- **Update deployed EdgeEver** keeps a deployment Fork as an upstream **deploy mirror**:
  - Default channel `stable` tracks the latest formal Release tag.
  - Set the GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` to follow upstream `main`.
  - Read-only forks (no app code changes) apply the target's product snapshot in a new linear commit without installing dependencies or running the project test suite.
  - Only forks that explicitly set `EDGE_EVER_PRESERVE_FORK_CHANGES=true` merge product changes. A customized merge runs local migrations, the complete non-E2E test suite, type checks, and the production build before pushing; any failure leaves `main` and production unchanged.
  - Formal Releases run the same complete non-E2E suite on an official Ubuntu job before Draft assets are prepared. This keeps the stable channel's upstream baseline green, so customized-fork failures indicate an integration problem rather than a test already broken by the Release itself.
  - The complete downstream `.github/workflows/**` directory and two updater helper scripts form a stable local bootstrap layer. Official packaging, signing, testing, and Release workflows are not part of automatic product updates, so `GITHUB_TOKEN` never needs permission to rewrite Actions workflows.
  - Every run writes a job **Summary** with channel, target version, decision reason, and whether a push happened. A green run that says *Already on upstream target* is success, not a silent failure.
  - Prefer this workflow over GitHub **Sync fork**. Sync fork follows upstream `main` history and can make the next stable run a deliberate no-op.
- Optional: repository secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL` triggers a Cloudflare Deploy Hook after a successful push (useful when the Git integration misses a push).
- Optional: re-run the workflow with **force_redeploy** to push an empty commit when Git is already current but Cloudflare needs another build.
- Build failure: inspect the Worker **Deployments** log and confirm the Deployment commit SHA matches Fork `main`.
- Scheduled update never runs: on a public Fork, enable **Update deployed EdgeEver** under **Actions** (scheduled workflows are disabled by default on forks, and may pause after long inactivity).
- Update push is rejected with `without workflows permission`: the Fork still has an older updater. Use GitHub **Sync fork** once with the repository owner's permission, then re-run **Update deployed EdgeEver**. Routine product updates do not require **Sync fork** after that bootstrap.
