# EdgeEver Manual Online Deployment Guide

This document provides a detailed step-by-step guide for deploying EdgeEver online via GitHub and Cloudflare. The entire setup is performed in your browser—**no local code installation or environment setup is required**.

> 💡 **Zero-Cost Self-Hosting**: Built completely on Cloudflare's free tiers—**no VPS or server rentals needed, and no Docker or SSL certificate setup required**.

---

## Prerequisites

- **GitHub Account** (for Forking the repository and enabling automated updates)
- **Cloudflare Account** (for hosting Worker logic, SQLite D1 database, and R2 storage)

---

## Step-by-Step Deployment Guide

### Step 1: Fork the Repository & Enable Actions

1. Visit the official EdgeEver repository: `https://github.com/tianma-if/edgeever`.
2. Click the **Fork** button at the top right to fork the repository into your GitHub account.
3. Go to your Forked repository, navigate to the **Actions** tab, and click **"I understand my workflows, go ahead and enable them"** to activate automated workflows.

---

### Step 2: Create Storage & Database Resources in Cloudflare

Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/):

1. **Create a D1 Database**:
   - Navigate to **Workers & Pages** -> **D1**, then click **Create database**.
   - Database name: exactly `edgeever`, then click **Create**.
2. **Create an R2 Bucket** (for note attachments & images):
   - Navigate to **Workers & Pages** -> **R2**, then click **Create bucket**.
   - Bucket name: exactly `edgeever-resources`, then click **Create bucket**.

---

### Step 3: Import Project & Configure the Login Secret

1. In Cloudflare Dashboard, navigate to **Workers & Pages** -> **Overview**, click **Create application** -> **Pages** / **Workers** (Import Git Repository).
2. Click **Connect to Git**, authorize Cloudflare, and select your Forked `edgeever` repository.
3. Project settings:
   - **Production branch**: `main`
   - **Root directory**: Leave blank or default `/`
4. Under **Settings** -> **Variables and Secrets**, add the login password:

| Type | Name | Value | Purpose |
| :--- | :--- | :--- | :--- |
| **Secret** | `EDGE_EVER_AUTH_PASSWORD` | Set a strong admin password | Initial login credential |

> `EDGE_EVER_AUTH_PASSWORD` is a Worker runtime Secret, not a Workers Builds variable. The standard deploy command reuses and verifies this Secret; do not duplicate the password in build variables.

The repository's deployment command creates the `DB` and `RESOURCES` bindings from the standard resource names. Do not edit `wrangler.toml` or add duplicate bindings in the Dashboard.

Existing deployments created from older instructions do not need to rename or migrate a custom R2 bucket. When no explicit Builds variable is set, the deploy command reads the live Worker's current `RESOURCES` binding and keeps using that bucket automatically.

---

### Step 4: Start the Build

Keep the default deploy command filled in by Cloudflare:

```text
Deploy command: npx wrangler deploy
```

Click **Save and Deploy** to trigger the initial build. The repository's Wrangler compatibility entrypoint detects Workers Builds and routes the default command through EdgeEver's complete build, database migration, deployment, and live verification pipeline. You do not need to copy a custom command, and the D1 placeholder in `wrangler.toml` cannot be submitted to Cloudflare.

The deployment pipeline automatically looks up the D1 UUID by the `edgeever` database name. Keep the tracked `wrangler.toml` unchanged; deployment rejects instance-specific values committed there. The Workers Builds API token must have D1 read/edit permission.

Existing projects may keep using these explicit commands without changing them:

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

After publishing, the CI deployment records the actual public target reported by Wrangler and requests its `/api/health` endpoint. The build fails if the live Worker is missing its `DB` or `RESOURCES` binding, uses an unprepared D1 database, or does not return a healthy response.

---

### Step 5: Verify Deployment & Login

1. After deployment completes, Cloudflare will assign a default domain (e.g., `https://edgeever.your-subdomain.workers.dev`).
2. Visit the health check endpoint in your browser: `https://<your-domain>/api/health`, and confirm it returns HTTP `200` with:
   ```json
   { "ok": true }
   ```
3. Open the homepage, log in with your configured administrator username (default: `admin`) and `EDGE_EVER_AUTH_PASSWORD`, and start using EdgeEver!
4. Go back to your Fork's **Actions** tab on GitHub and manually trigger **Update deployed EdgeEver** once to ensure upstream updates will sync properly in the future.

---

## Advanced Configuration: Update Channels

By default, **Update deployed EdgeEver** follows official stable Release tags. To follow upstream `main` (Edge preview builds), set this **GitHub Repository Variable** on the Fork (**Settings → Secrets and variables → Actions → Variables**):

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

You can also pick `stable` / `edge` when manually running the workflow.

## Advanced Configuration: Instance Settings

Ordinary deployments do not need these settings. To customize an instance, add non-secret values under **Settings -> Builds -> Variables and secrets** instead of changing repository files:

| Build variable | Purpose |
| :--- | :--- |
| `EDGE_EVER_AUTH_USERNAME` | Administrator username; defaults to `admin` |
| `EDGE_EVER_WORKER_NAME` | Worker name |
| `EDGE_EVER_D1_DATABASE_NAME` | D1 database name; its UUID is discovered automatically |
| `EDGE_EVER_D1_DATABASE_ID` | Optional UUID fallback when discovery is unavailable |
| `EDGE_EVER_R2_BUCKET_NAME` | Optional explicit production R2 bucket override; upgrades otherwise reuse the live binding |
| `EDGE_EVER_R2_PREVIEW_BUCKET_NAME` | Preview R2 bucket name |
| `EDGE_EVER_WORKERS_DEV` | Enable or disable the `workers.dev` route |
| `EDGE_EVER_CUSTOM_DOMAIN` / `EDGE_EVER_ROUTE_PATTERN` | Custom routing |

Passwords and other credentials remain Worker runtime Secrets and must never be added to Builds variables. An advanced local deployment may instead use the git-ignored `.env.local` or an external `WRANGLER_CONFIG` file.

---

## Troubleshooting

- **Initial build failed**: Check the Worker **Deployments** log for “routing it through EdgeEver's validated deployment pipeline”. Verify that the standard resources are named exactly `edgeever` and `edgeever-resources`, and that the Workers Builds API token has D1 read/edit permission. For an intentionally different D1 database, set `EDGE_EVER_D1_DATABASE_NAME`; add `EDGE_EVER_D1_DATABASE_ID` only if automatic UUID discovery is unavailable.
- **Updates not syncing**:
  1. On the Fork **Actions** tab, enable **Update deployed EdgeEver** (scheduled workflows are off by default on public forks).
  2. Run it once with **Run workflow**. Open the bilingual job **Summary**: it separately reports the upstream target, Git publish result, deployment trigger, and whether the live deployment was verified.
  3. A scheduled green run with *Already on upstream target* means Git already matches that channel — not a broken skip. A manual run automatically republishes the selected version when already aligned. If the live site is still old afterward, compare the Cloudflare **Deployments** commit SHA.
  4. Prefer this workflow over GitHub **Sync fork** for day-to-day upgrades.
  5. If an old updater fails with `without workflows permission`, use **Sync fork** once as the repository owner, then re-run **Update deployed EdgeEver**. The current updater preserves `.github/workflows/**`, so later product updates do not hit this permission boundary.
- **Push succeeded but site unchanged**: Confirm Workers Builds ran for the new `main` SHA. Optionally add repository secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL` so the workflow can call a Deploy Hook after publish.
- **The Android or iOS app reports that Cloudflare or a security policy blocked sign-in**:
  1. Retry once and record the diagnostic code, Ray ID, and approximate time shown by the app. In Cloudflare, open **Security → Analytics → Events**, find the matching request, and check its **Service**, **Action**, and rule ID before changing any protection.
  2. Native apps call `/api/*` directly and cannot complete an interactive browser challenge. Do not try to solve this by embedding the challenge in the app. Keep EdgeEver authentication and its application-level login rate limits enabled, but make sure legitimate API traffic receives a machine-readable response instead of a Managed or Interactive Challenge.
  3. If a custom WAF rule issued the challenge, narrow that rule so it does not challenge the required `/api/*` requests. For Managed Rules or Super Bot Fight Mode false positives, create the smallest applicable [Skip rule or exception](https://developers.cloudflare.com/waf/custom-rules/skip/). Do not broadly disable unrelated security controls.
  4. Cloudflare's free Bot Fight Mode cannot be bypassed by a WAF Skip rule. If Security Events identifies Bot Fight Mode, follow Cloudflare's [false-positive guidance](https://developers.cloudflare.com/bots/troubleshooting/false-positives/) and either disable it or use a protection mode that supports scoped exceptions.
- **Reset or Manual Recovery**: See the [Cloudflare Manual Deployment Guide](manual-deploy.md).
