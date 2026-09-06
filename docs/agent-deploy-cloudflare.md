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

3. **Cloudflare Project Import**
   - Log into the Cloudflare **Workers & Pages** console and import the Fork repository.
   - Configure the project to use the repository root, the production `main` branch, and read the root `wrangler.toml`.

4. **Configure Login Credentials & Instance Settings**
   - **Worker Secret**: Add secret `EDGE_EVER_AUTH_PASSWORD` for the initial administrator password. Prefer a strong password of at least 32 characters that is unique to this instance.
   - Keep this password only as a Worker runtime Secret; do not copy it into Workers Builds variables. The standard deploy entrypoint reuses and verifies the existing Secret.
   - Do not edit `wrangler.toml` or add duplicate bindings in the Dashboard. The deployment command generates the `DB` and `RESOURCES` bindings from these standard resource names.
   - For an existing Worker deployed from older instructions, do not ask the user to rename or reconfigure a custom R2 bucket. With no explicit override, deployment automatically preserves the live `RESOURCES` binding and administrator username.

5. **Configure Workers Builds Commands**
   - In the Cloudflare project build settings, set the standard commands:

     ```text
     Build command: bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
     Deploy command: bun run deploy:cloudflare-builds
     ```

   - The deploy command automatically resolves the D1 UUID from the `edgeever` database name and writes all instance settings only to a temporary generated Wrangler configuration. The tracked `wrangler.toml` must remain unchanged; deployment rejects instance-specific values committed there so a Fork cannot diverge on infrastructure configuration.
   - Ensure the Workers Builds API token can read and edit D1. Advanced non-secret customization belongs in `EDGE_EVER_*` Workers Builds variables. For a differently named database, set `EDGE_EVER_D1_DATABASE_NAME`; set `EDGE_EVER_D1_DATABASE_ID` only if automatic UUID discovery is unavailable. Passwords remain runtime Secrets.

6. **Start Initial Build & Verify Service**
   - Trigger the initial build. Once deployed, run the following automated verifications:
     - Check `https://<your-worker-domain>/api/health` returns HTTP `200` with JSON `{"ok": true}`.
     - Check `https://<your-worker-domain>/api/openapi.json` loads the OpenAPI schema properly.
     - Verify login API using username `admin` and `EDGE_EVER_AUTH_PASSWORD`.

7. **Verify Upstream Update Channel**
   - In the Fork's **Actions** tab, enable **Update deployed EdgeEver** (required on public forks: scheduled workflows are disabled by default).
   - An ordinary Fork is a deployment mirror by default. No update variable is required: the workflow applies the selected upstream Release's product snapshot to `main` before triggering Cloudflare.
   - The updater preserves the Fork's complete `.github/workflows/**` directory and its two updater helper scripts as a stable local bootstrap layer. Official packaging, signing, testing, and Release workflows remain guarded to `tianma-if/edgeever` and are never rewritten by downstream product updates.
   - Only a Fork that intentionally maintains application-code changes should create the Actions repository variable `EDGE_EVER_PRESERVE_FORK_CHANGES=true`. This opts into merges and requires the owner to resolve future conflicts; it is not needed for normal deployments.
   - Manually trigger **Update deployed EdgeEver** once in the Fork's **Actions** tab. A manual run republishes the selected version even when the Fork is already aligned, ensuring Cloudflare receives a fresh build event.
   - Open the job **Summary** and confirm it reports Fork mode `mirror`, the upstream target (stable Release or edge `main`), and either an update publish or an explicit *already aligned* result.
   - Confirm Cloudflare **Deployments** builds the published `main` commit when a push occurred.
   - Do not edit deployment files or rely on GitHub **Sync fork** for routine upgrades; the workflow is the only synchronization path needed by a normal deployment Fork. Use **Sync fork** once only when an old Fork must receive a newer updater workflow itself, then return to **Update deployed EdgeEver**.

## Optional: Customize the Initial Administrator Username

Ordinary deployments use the default username `admin`; do not proactively ask the user whether to change it. Only when the user explicitly requests a custom administrator username, set `EDGE_EVER_AUTH_USERNAME` in Workers Builds variables before the first build and use that username during login verification. Changing only this variable after the administrator account exists does not rename that account.
