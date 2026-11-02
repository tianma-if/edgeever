# AI Agent Cloudflare Deployment Guide

This document defines the standard operating specifications and conventions for AI Agents (and automated deployment scripts) deploying EdgeEver on Cloudflare.

> 💡 **Core Principle**: Pure Serverless architecture running entirely within Cloudflare free limits—no VPS or server purchasing, no Docker or SSL certificate configuration required.

---

## Standard Automated Deployment Steps

1. **Fork Repository**
   - Fork `tianma-if/edgeever` to the target GitHub account.

2. **Create Cloudflare Resources**
   - Create a D1 database named exactly `edgeever`.
   - Create an R2 bucket named exactly `edgeever-resources`.

3. **Create the Worker**
   - In **Workers & Pages** → **Create application** → **Start with Hello World!**, create and deploy a Worker named exactly `edgeever`.
   - This is a placeholder service, not a completed EdgeEver deployment. For an existing EdgeEver instance, reuse its Worker and authentication Secret; do not replace its application with Hello World or reset its password.

4. **Configure the Runtime Secret Before Connecting the Fork**
   - Under the Worker's **Settings** → **Variables and Secrets**, add `EDGE_EVER_AUTH_PASSWORD` as type **Secret**, using the initial administrator login password (preferably at least 32 characters), and select **Deploy**.
   - Confirm the Secret name appears in the list before connecting the repository. Keep the password only as a Worker runtime Secret, never in Workers Builds variables or Fork files.

5. **Connect the Fork**
   - Open this existing Worker's **Settings** → **Builds** → **Connect**, authorize GitHub access, and select the Fork's `main` branch. Follow [Cloudflare's existing-Worker instructions](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker). Do not use the Deploy to Cloudflare template entrypoint or create a Pages application.
   - Use the repository root and default deploy command `npx wrangler deploy`; Cloudflare runs it online through EdgeEver's validated deployment pipeline. Existing deployments may keep explicit `bun run build:cloudflare` and `bun run deploy:cloudflare-builds` commands.
   - Do not edit `wrangler.toml` or add duplicate bindings. Deployment automatically resolves the D1 UUID from `edgeever` and generates temporary `DB` and `RESOURCES` bindings. For a different database name, set `EDGE_EVER_D1_DATABASE_NAME`; use `EDGE_EVER_D1_DATABASE_ID` only if UUID discovery is unavailable. Non-secret instance settings belong in Workers Builds variables.
   - Existing deployments retain their live `RESOURCES` binding and administrator username unless explicitly overridden; do not ask users to rename or reconfigure a custom R2 bucket. Keep tracked configuration unchanged so the Fork remains a deployment mirror.

6. **Configure Deployment Permissions**
   - In **Settings → Builds → API token**, select or create the Cloudflare API token used by Workers Builds to deploy the application. **Create new token** generates a token automatically; its defaults may lack D1. Add D1 read/edit permission for the target account under [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens), retaining its existing deployment permissions. Select this token in the Worker’s **Settings → Builds → API token** and save the build settings. Subsequent Cloudflare Workers Builds runs use it for database migrations and Worker deployment.

7. **Start the First Build and Verify the Service**
   - Use `admin` unless the user requests another username; configure `EDGE_EVER_AUTH_USERNAME` before starting the first build if requested.
   - In the Fork's GitHub repository, open **Actions → Update deployed EdgeEver**, enable the workflow if prompted, select `main`, and click **Run workflow**. This republishes the selected upstream version even when the Fork is already aligned. Return to Cloudflare **Deployments** to monitor the corresponding build.
   - Missing authentication configuration is a deployment error to correct, not an expected first-build failure. Keep all authentication and deployment checks enabled.
   - After confirming in Cloudflare that the corresponding build succeeded and deployment completed, verify `/api/health` returns HTTP `200` with `{"ok": true}`, `/api/openapi.json` is reachable with JSON containing `"ok": true`, and the login API accepts the configured administrator username and password. A Hello World response does not pass verification.

   - This workflow will automatically sync future stable releases and fixes.

## Upstream Update Channel
   - An ordinary Fork is a deployment mirror by default. No update variable is required: the workflow applies the selected upstream Release's product snapshot to `main` before triggering Cloudflare.
   - The updater preserves the Fork's complete `.github/workflows/**` directory and its two updater helper scripts as a stable local bootstrap layer. Official packaging, signing, testing, and Release workflows remain guarded to `tianma-if/edgeever` and are never rewritten by downstream product updates.
   - Only a Fork that intentionally maintains application-code changes should create the Actions repository variable `EDGE_EVER_PRESERVE_FORK_CHANGES=true`. This opts into merges and requires the owner to resolve future conflicts; it is not needed for normal deployments.
   - Open the job **Summary** and confirm it reports Fork mode `mirror`, the upstream target (stable Release or edge `main`), and either an update publish or an explicit *already aligned* result.
   - Confirm Cloudflare **Deployments** builds the published `main` commit when a push occurred.
   - Do not edit deployment files or rely on GitHub **Sync fork** for routine upgrades; the workflow is the only synchronization path needed by a normal deployment Fork. Use **Sync fork** once only when an old Fork must receive a newer updater workflow itself, then return to **Update deployed EdgeEver**.

## Optional: Customize the Initial Administrator Username

Ordinary deployments use the default username `admin`; do not proactively ask the user whether to change it. Only when the user explicitly requests a custom administrator username, set `EDGE_EVER_AUTH_USERNAME` in Workers Builds variables before starting the first build and use that username during login verification. Changing only this variable after the administrator account exists does not rename that account.
