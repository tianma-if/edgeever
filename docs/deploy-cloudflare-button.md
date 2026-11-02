# EdgeEver Manual Online Deployment Guide

Deploy EdgeEver through GitHub and Cloudflare in your browser, without installing code locally or configuring a server.

---

## Prerequisites

- **GitHub Account** (for Forking the repository and enabling automated updates)
- **Cloudflare Account** (for hosting Worker logic, SQLite D1 database, and R2 storage)

---

## First Deployment

Complete the following steps strictly in order.

### Step 1: Fork the Repository

1. Visit the official EdgeEver repository: `https://github.com/tianma-if/edgeever`.
2. Click the **Fork** button at the top right to fork the repository into your GitHub account.

---

### Step 2: Create Storage & Database Resources in Cloudflare

Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/). If an entry moves, see the official [D1](https://developers.cloudflare.com/d1/get-started/) and [R2](https://developers.cloudflare.com/r2/get-started/) guides:

1. **Create a D1 Database**:
   - Under **Storage & databases**, open **D1 SQL Database** and click **Create database**.
   - Database name: exactly `edgeever`, then click **Create**.
2. **Create an R2 Bucket** (for note attachments & images):
   - Under **Storage & databases**, open **R2** -> **Overview**. If R2 is not yet enabled, complete the subscription flow shown there; then click **Create bucket**.
   - Bucket name: exactly `edgeever-resources`, then click **Create bucket**.

---

### Step 3: Create the Worker

1. Open **Workers & Pages** → **Create application** → **Start with Hello World!**. Name the Worker exactly `edgeever` and click **Deploy**.

---

### Step 4: Set the Administrator Password

1. Open this Worker's **Settings** → **Variables and Secrets**, click **Add**, add the runtime Secret below, and click **Deploy**:

| Type | Name | Value | Purpose |
| :--- | :--- | :--- | :--- |
| **Secret** | `EDGE_EVER_AUTH_PASSWORD` | Preferably at least 32 characters | Administrator login password |

`EDGE_EVER_AUTH_PASSWORD` is the variable name; its value is the administrator login password. It is a Worker runtime Secret, not a Workers Builds variable.

Confirm the Secret name appears in the list before continuing. The Worker currently serves a Hello World placeholder; EdgeEver will replace it after the repository build. Do not enter your password on the placeholder page.

---

### Step 5: Connect the Fork

1. In the **existing** `edgeever` Worker, open **Settings** → **Builds** → **Connect**. Authorize GitHub access to your Fork and select that repository. Follow [Cloudflare's existing-Worker instructions](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker) if the entry moves.
2. Configure Workers Builds:
   - **Production branch**: `main`
   - **Root directory**: Leave blank to use the repository root
   - Deploy command: npx wrangler deploy (keep the default; Cloudflare runs it online)

The Worker name must match `edgeever` in the repository's `wrangler.toml`. The deployment command creates the `DB` and `RESOURCES` bindings and looks up the D1 UUID. Do not edit Fork files or add duplicate bindings in the Dashboard.

---

### Step 6: Configure Deployment Permissions

**API token**: Select or create a User API Token scoped to the target account with D1 read and edit permissions; selecting **Create new token** lets Cloudflare generate a deployment token, but its default permissions may lack D1. Edit that token under [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) to add D1 permission for the target account, then select it in the Worker’s **Settings → Builds → API token**. Keep its existing deployment permissions. Select this token in the Worker’s **Settings → Builds → API token** and save the build settings. Subsequent Cloudflare Workers Builds runs use it for database migrations and Worker deployment.

---

### Step 7: Build and Verify Login

The administrator username defaults to `admin`. If you need a custom username, configure the Workers Builds variable `EDGE_EVER_AUTH_USERNAME` before starting the first build.

In the Fork's GitHub repository, open **Actions → Update deployed EdgeEver**, enable the workflow if prompted, select `main`, and click **Run workflow**. This republishes the selected upstream version even when the Fork is already aligned. Return to Cloudflare **Deployments** to monitor the corresponding build. Confirm that the build succeeded and deployment completed before performing the following checks:

1. After deployment completes, Cloudflare will assign a default domain (e.g., `https://edgeever.your-subdomain.workers.dev`). You can also attach your own custom domain in the Worker settings under **Settings → Domains & Routes**.
2. Visit the health check endpoint in your browser: `https://<your-domain>/api/health`, and confirm it returns HTTP `200` with:
   ```json
   { "ok": true }
   ```
3. Open the homepage, log in with your configured administrator username (default: `admin`) and `EDGE_EVER_AUTH_PASSWORD`, and start using EdgeEver!


This workflow will automatically sync future stable releases and fixes.

---

## Advanced Configuration: Update Channels

By default, **Update deployed EdgeEver** follows official stable Release tags. To follow upstream `main` (Edge preview builds), set this **GitHub Repository Variable** on the Fork (**Settings → Secrets and variables → Actions → Variables**):

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

You can also pick `stable` / `edge` when manually running the workflow.

## Advanced Configuration: Instance Settings

To customize an instance, add non-secret values under the Worker's **Settings → Build → Build variables and secrets**:

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

Set a custom administrator username before starting the first build; changing the variable after the account exists does not rename it.

Older deployments need not migrate a custom R2 bucket; upgrades reuse the live `RESOURCES` binding unless overridden. Existing explicit build commands remain supported; see [Workers Builds configuration](cloudflare-workers-builds.md).

---

## Troubleshooting

- **Missing administrator Secret**: Add and deploy the runtime Secret from Step 4 on the same Worker connected to the Fork, then retry the failed build. Missing configuration is not a required first-deployment step.
- **Still seeing Hello World**: Creating the Worker or deploying its Secret does not deploy EdgeEver. Complete Step 7 and confirm the successful production build uses the Fork’s `main` commit.
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
