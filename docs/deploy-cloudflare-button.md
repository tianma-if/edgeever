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
   - Database name: `edgeever`, then click **Create**.
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
| **Environment Variable (Secret)** | `EDGE_EVER_AUTH_PASSWORD` | Set your admin password | Initial login credential |

---

### Step 4: Set Build Commands & Start Build

In the Cloudflare project **Build settings**, configure:

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

Click **Save and Deploy** to trigger the initial build.

---

### Step 5: Verify Deployment & Login

1. After deployment completes, Cloudflare will assign a default domain (e.g., `https://edgeever.your-subdomain.workers.dev`).
2. Visit the health check endpoint in your browser: `https://<your-domain>/api/health`, and confirm it returns HTTP `200` with:
   ```json
   { "ok": true }
   ```
3. Open the homepage, log in with your configured `EDGE_EVER_AUTH_PASSWORD`, and start using EdgeEver!
4. Go back to your Fork's **Actions** tab on GitHub and manually trigger **Update deployed EdgeEver** once to ensure upstream updates will sync properly in the future.

---

## Advanced Configuration: Update Channels

By default, deployments follow official stable Release tags. If you want to follow the latest `main` branch (Edge preview builds), add the following environment variable in Cloudflare under **Settings** -> **Variables and Bindings**:

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

---

## Troubleshooting

- **Initial build failed**: Check the Worker **Deployments** log in Cloudflare to verify that D1 (`DB`) and R2 (`RESOURCES`) binding names match the exact case required.
- **Updates not syncing**: Navigate to your Fork's **Actions** tab, verify **Update deployed EdgeEver** is enabled, and try clicking **Run workflow** manually.
- **Reset or Manual Recovery**: See the [Cloudflare Manual Deployment Guide](manual-deploy.md).
