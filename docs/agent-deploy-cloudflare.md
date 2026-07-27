# AI Agent Cloudflare Deployment Guide

This document defines the standard operating specifications and conventions for AI Agents (and automated deployment scripts) deploying EdgeEver on Cloudflare.

> 💡 **Core Principle**: Pure Serverless architecture running entirely within Cloudflare free limits—no VPS or server purchasing, no Docker or SSL certificate configuration required.

---

## Standard Automated Deployment Steps

1. **Fork Repository**
   - Fork `tianma-if/edgeever` to the target GitHub account.

2. **Enable Workflow**
   - In the **Actions** tab of the Forked repository, enable the **Update deployed EdgeEver** automatic update workflow.

3. **Cloudflare Project Import**
   - Log into the Cloudflare **Workers & Pages** console and import the Fork repository.
   - Configure the project to use the repository root, the production `main` branch, and read the root `wrangler.toml`.

4. **Resource Bindings & Secrets**
   - **D1 Database Binding**: Binding name `DB`, associated with a database named exactly `edgeever`.
   - **R2 Bucket Binding**: Binding name `RESOURCES`, associated with a globally unique R2 Bucket.
   - **Admin username**: Configure `EDGE_EVER_AUTH_USERNAME`; it defaults to `admin` and can be replaced with a custom username.
   - **Worker Secret**: Add secret `EDGE_EVER_AUTH_PASSWORD` for initial admin password.

5. **Configure Workers Builds Commands**
   - In the Cloudflare project build settings, set the standard commands:

     ```text
     Build command: bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
     Deploy command: bun run deploy:cloudflare-builds
     ```

   - The deploy command automatically resolves the D1 UUID from the `edgeever` database name and writes it only to a temporary generated Wrangler configuration. Users do not need to edit `wrangler.toml` or copy a D1 ID into a build variable.
   - Ensure the Workers Builds API token can read and edit D1. An advanced deployment that uses a differently named database must set the build variable `EDGE_EVER_D1_DATABASE_ID` explicitly.

6. **Start Initial Build & Verify Service**
   - Trigger the initial build. Once deployed, run the following automated verifications:
     - Check `https://<your-worker-domain>/api/health` returns HTTP `200` with JSON `{"ok": true}`.
     - Check `https://<your-worker-domain>/api/openapi.json` loads the OpenAPI schema properly.
     - Verify login API using the configured `EDGE_EVER_AUTH_USERNAME` (default `admin`) and `EDGE_EVER_AUTH_PASSWORD`.

7. **Verify Upstream Update Channel**
   - Manually trigger **Update deployed EdgeEver** once in the Fork's **Actions** tab to confirm upstream synchronization and automated builds work properly.
