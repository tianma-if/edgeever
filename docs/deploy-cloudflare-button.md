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
   - Enter a globally unique bucket name (e.g., `my-edgeever-resources`), then click **Create bucket**.

---

### Step 3: Import Project & Configure Resources (Bindings & Secrets)

1. In Cloudflare Dashboard, navigate to **Workers & Pages** -> **Overview**, click **Create application** -> **Pages** / **Workers** (Import Git Repository).
2. Click **Connect to Git**, authorize Cloudflare, and select your Forked `edgeever` repository.
3. Project settings:
   - **Production branch**: `main`
   - **Root directory**: Leave blank or default `/`
4. **Configure Bindings & Variables** (under **Settings** -> **Variables and Bindings**):

| Type | Binding / Variable Name | Value / Bound Resource | Purpose |
| :--- | :--- | :--- | :--- |
| **D1 Database Binding** | `DB` | Select `edgeever` database | Stores notes & structured data |
| **R2 Bucket Binding** | `RESOURCES` | Select your created R2 bucket | Stores images & file attachments |
| **Environment Variable** | `EDGE_EVER_AUTH_USERNAME` | `admin` (customizable) | Admin login username |
| **Environment Variable (Secret)** | `EDGE_EVER_AUTH_PASSWORD` | Set your admin password | Initial login credential |

> `EDGE_EVER_AUTH_USERNAME` is prefilled with `admin`. Most users can keep this value. Advanced users can replace it with a custom administrator username; the configured username is required at login.

> `EDGE_EVER_AUTH_PASSWORD` is a Worker runtime Secret, not a Workers Builds variable. The standard deploy command reuses and verifies this Secret; do not duplicate the password in build variables.

---

### Step 4: Set Build Commands & Start Build

In the Cloudflare project **Build settings**, configure:

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

Click **Save and Deploy** to trigger the initial build.

The deploy command automatically looks up the D1 UUID by the `edgeever` database name. Do not edit `wrangler.toml` or manually copy the D1 ID. The Workers Builds API token must have D1 read/edit permission.

After publishing, the CI deployment records the actual public target reported by Wrangler and requests its `/api/health` endpoint. The build fails if the live Worker is missing its `DB` binding, uses an unprepared D1 database, or does not return a healthy response.

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

---

## Troubleshooting

- **Initial build failed**: Check the Worker **Deployments** log. Verify that the D1 binding is `DB`, its database is named exactly `edgeever`, the R2 binding is `RESOURCES`, and the Workers Builds API token has D1 read/edit permission. For an intentionally different D1 database, add the build variable `EDGE_EVER_D1_DATABASE_ID` with its UUID.
- **Updates not syncing**:
  1. On the Fork **Actions** tab, enable **Update deployed EdgeEver** (scheduled workflows are off by default on public forks).
  2. Run it once with **Run workflow**. Open the job **Summary**: it states the upstream target version and whether the fork was updated, already aligned, or failed.
  3. A green run with *Already on upstream target* means Git already matches that channel — not a broken skip. If the live site is still old, check Cloudflare **Deployments** commit SHA, or re-run with **force_redeploy**.
  4. Prefer this workflow over GitHub **Sync fork** for day-to-day upgrades.
  5. If an old updater fails with `without workflows permission`, use **Sync fork** once as the repository owner, then re-run **Update deployed EdgeEver**. The current updater preserves `.github/workflows/**`, so later product updates do not hit this permission boundary.
- **Push succeeded but site unchanged**: Confirm Workers Builds ran for the new `main` SHA. Optionally add repository secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL` so the workflow can call a Deploy Hook after publish.
- **Reset or Manual Recovery**: See the [Cloudflare Manual Deployment Guide](manual-deploy.md).
