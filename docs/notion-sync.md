# Notion Two-Way Sync

EdgeEver includes built-in real-time two-way synchronization with a Notion database. The same platform-neutral implementation runs on both Cloudflare Workers and self-hosted (Docker / Bun) deployments without requiring a separate sync service.

## Features

- **Synchronized fields**: Note title, Markdown body, tags (`Tags`), notebook (`Notebook`), and pin state (`Pinned`). Deleting a note archives the corresponding Notion page or moves the EdgeEver note to trash.
- **Automatic database schema setup**: Detects the existing title property regardless of its display name and automatically creates `Tags` (`multi_select`), `Notebook` (`select`), `Pinned` (`checkbox`), and `EdgeEver ID` (`rich_text`) if missing.
- **Loop prevention and idempotency**:
  - EdgeEver pushes changes only for mutations committed outside the internal `notion-sync` actor;
  - Incoming Notion webhooks ignore events authored exclusively by `bot` actors, verify `X-Notion-Signature` (HMAC-SHA256), and deduplicate delivery IDs;
  - Normalized SHA-256 content snapshots skip redundant writes in both directions.
- **Structured note safety**: Poster, structured table, diagram, and infographic notes export readable fallback Markdown to Notion while preserving their structured source if metadata is edited in Notion.

## Setup

1. **Create a Notion integration and share a database**
   - Open [Notion Integrations](https://www.notion.so/profile/integrations), create an Internal Integration with read, update, and insert content capabilities, and copy the `ntn_...` secret.
   - Open your target Notion database page, click `•••` → **Connections**, and connect the integration.
   - Copy the Notion database link or 32-character database ID.

2. **Configure EdgeEver**
   - Sign in as the workspace owner and open **Settings → Data → Notion two-way sync → Configure**.
   - Paste the integration secret and database link (or ID), click **Test connection**, and click **Save settings**.
   - Copy the generated workspace **Notion webhook callback URL** (`/api/public/webhooks/notion/<token>`).

3. **Activate Notion Webhooks**
   - In [Notion Integrations](https://www.notion.so/profile/integrations), open your integration → **Webhooks** → **Create a subscription**.
   - Paste the callback URL, select page events (`page.created`, `page.content_updated`, `page.properties_updated`, `page.deleted`, `page.undeleted`, `page.moved`), and send the verification token.
   - Copy the `secret_...` verification token displayed directly inside the EdgeEver configuration dialog and paste it into Notion's verification prompt. EdgeEver automatically promotes and encrypts the verified token once the first signed webhook arrives.

4. **Initial full sync (optional)**
   - Click **Sync all now** to align existing notes across both sides in bounded cursor-paginated batches.
