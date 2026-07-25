# Cloudflare Workers Builds

## Setup

Use the build and deploy commands from the [online deployment guide](deploy-cloudflare-button.md), with root directory `/` and production branch `main`.

Authorization:

1. Approve the **Cloudflare Workers & Pages** GitHub App for the deployment repository.
2. If the Agent integration needs a Cloudflare API token, use a User API Token limited to the target account.
3. Configure the deployment API token in Cloudflare under **Worker -> Settings -> Builds -> API token**.

## Updates and troubleshooting

- A push to `main` builds, applies D1 migrations, deploys, and verifies EdgeEver.
- **Update deployed EdgeEver** checks the latest formal Release daily.
- Set the GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` to follow upstream `main`.
- Build failure: inspect the Worker **Deployments** log.
- Scheduled update failure: enable and run the workflow from the Fork's **Actions** tab.

Legacy Cloudflare-created repositories with only a `source repo import` commit are bootstrapped on their first update. Do not use this bootstrap path after custom application changes.
