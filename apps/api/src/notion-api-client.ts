import { AppError } from "./app-error";
import { normalizeNotionUuid } from "./notion-sync-crypto";
import {
  markdownToNotionBlocks,
  notionBlocksToMarkdown,
  type NotionBlockPayload,
  type NotionRichTextItem,
} from "./notion-markdown";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const NOTION_REQUEST_TIMEOUT_MS = 12_000;
const BLOCK_BATCH_SIZE = 100;

export const NOTION_PROP_TAGS = "Tags";
export const NOTION_PROP_NOTEBOOK = "Notebook";
export const NOTION_PROP_PINNED = "Pinned";
export const NOTION_PROP_EDGEEVER_ID = "EdgeEver ID";

export type NotionTransport = (input: string, init: RequestInit) => Promise<Response>;

export type NotionPageSnapshot = {
  id: string;
  parentDatabaseId: string | null;
  archived: boolean;
  inTrash: boolean;
  title: string;
  tags: string[];
  notebookName: string;
  isPinned: boolean;
  edgeEverId: string | null;
  markdown: string;
  lastEditedTime: string;
};

const sanitizeSelectOption = (value: string): string =>
  value.replace(/,/g, " ").trim().slice(0, 100);

const extractPlainText = (items: NotionRichTextItem[] | undefined): string =>
  (items ?? []).map((item) => item.plain_text ?? item.text?.content ?? "").join("").trim();

export class NotionApiClient {
  private readonly apiToken: string;
  readonly databaseId: string;
  private readonly transport: NotionTransport;
  private cachedTitleProperty: string | null = null;
  private cachedDatabaseTitle: string | null = null;

  constructor(options: {
    apiToken: string;
    databaseId: string;
    transport?: NotionTransport;
  }) {
    this.apiToken = options.apiToken.trim();
    this.databaseId = normalizeNotionUuid(options.databaseId);
    this.transport = options.transport ?? ((url, init) => fetch(url, init));
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.transport(`${NOTION_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
          "User-Agent": "EdgeEver-NotionSync/1.0",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS),
      });

      if (allowNotFound && response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      if (
        (response.status === 429 || response.status === 502 || response.status === 503)
        && attempt < 2
      ) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        await response.body?.cancel().catch(() => undefined);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 4) * 1000),
        );
        continue;
      }

      if (!response.ok) {
        const rawText = await response.text().catch(() => "");
        let detail = rawText.slice(0, 400);
        try {
          const parsed = JSON.parse(rawText) as { message?: string };
          if (parsed?.message) detail = parsed.message;
        } catch {
          // Keep raw snippet.
        }
        throw new AppError(
          response.status === 401 || response.status === 403
            ? "notion_auth_failed"
            : response.status === 404
              ? "notion_database_not_found"
              : "notion_api_error",
          `Notion API error (${response.status}): ${detail || response.statusText}`,
          response.status === 401 || response.status === 403 ? 400 : 502,
        );
      }

      return (await response.json()) as T;
    }

    throw new AppError("notion_api_error", "Notion API request exhausted retries.", 502);
  }

  async ensureDatabaseSchema(): Promise<{ titleProperty: string; databaseTitle: string }> {
    if (this.cachedTitleProperty && this.cachedDatabaseTitle !== null) {
      return {
        titleProperty: this.cachedTitleProperty,
        databaseTitle: this.cachedDatabaseTitle,
      };
    }

    const db = await this.request<{
      title?: NotionRichTextItem[];
      properties?: Record<string, { id: string; type: string }>;
    }>(`/databases/${this.databaseId}`);
    if (!db) {
      throw new AppError(
        "notion_database_not_found",
        "Notion database not found or not shared with the integration.",
        404,
      );
    }

    const props = db.properties ?? {};
    let titleProperty = "Name";
    for (const [name, prop] of Object.entries(props)) {
      if (prop.type === "title") {
        titleProperty = name;
        break;
      }
    }

    const missing: Record<string, unknown> = {};
    if (!props[NOTION_PROP_TAGS]) missing[NOTION_PROP_TAGS] = { multi_select: {} };
    if (!props[NOTION_PROP_NOTEBOOK]) missing[NOTION_PROP_NOTEBOOK] = { select: {} };
    if (!props[NOTION_PROP_PINNED]) missing[NOTION_PROP_PINNED] = { checkbox: {} };
    if (!props[NOTION_PROP_EDGEEVER_ID]) missing[NOTION_PROP_EDGEEVER_ID] = { rich_text: {} };

    if (Object.keys(missing).length > 0) {
      await this.request(`/databases/${this.databaseId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: missing }),
      });
    }

    const databaseTitle = extractPlainText(db.title) || "Untitled";
    this.cachedTitleProperty = titleProperty;
    this.cachedDatabaseTitle = databaseTitle;
    return { titleProperty, databaseTitle };
  }

  private buildPropertiesPayload(
    titleProperty: string,
    input: {
      title: string;
      tags: string[];
      notebookName: string;
      isPinned: boolean;
      edgeEverId: string;
    },
  ): Record<string, unknown> {
    const cleanTags = Array.from(
      new Set(input.tags.map((t) => sanitizeSelectOption(t.replace(/^#+/, ""))).filter(Boolean)),
    ).slice(0, 50);
    const notebook = sanitizeSelectOption(input.notebookName);

    return {
      [titleProperty]: {
        title: [{ type: "text", text: { content: (input.title.trim() || "Untitled").slice(0, 1900) } }],
      },
      [NOTION_PROP_TAGS]: {
        multi_select: cleanTags.map((name) => ({ name })),
      },
      [NOTION_PROP_NOTEBOOK]: {
        select: notebook ? { name: notebook } : null,
      },
      [NOTION_PROP_PINNED]: {
        checkbox: Boolean(input.isPinned),
      },
      [NOTION_PROP_EDGEEVER_ID]: {
        rich_text: [{ type: "text", text: { content: input.edgeEverId } }],
      },
    };
  }

  async createNotePage(input: {
    title: string;
    markdown: string;
    tags: string[];
    notebookName: string;
    isPinned: boolean;
    edgeEverId: string;
  }): Promise<string> {
    const { titleProperty } = await this.ensureDatabaseSchema();
    const blocks = markdownToNotionBlocks(input.markdown);

    const created = await this.request<{ id: string }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: this.databaseId },
        properties: this.buildPropertiesPayload(titleProperty, input),
        children: blocks.slice(0, BLOCK_BATCH_SIZE),
      }),
    });
    if (!created?.id) {
      throw new AppError("notion_api_error", "Failed to create Notion page.", 502);
    }

    const pageId = normalizeNotionUuid(created.id);
    for (let offset = BLOCK_BATCH_SIZE; offset < blocks.length; offset += BLOCK_BATCH_SIZE) {
      await this.appendBlocks(pageId, blocks.slice(offset, offset + BLOCK_BATCH_SIZE));
    }
    return pageId;
  }

  async updateNotePage(
    rawPageId: string,
    input: {
      title: string;
      markdown: string;
      tags: string[];
      notebookName: string;
      isPinned: boolean;
      edgeEverId: string;
    },
    replaceBody = true,
  ): Promise<void> {
    const pageId = normalizeNotionUuid(rawPageId);
    const { titleProperty } = await this.ensureDatabaseSchema();

    await this.request(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        archived: false,
        properties: this.buildPropertiesPayload(titleProperty, input),
      }),
    });

    if (replaceBody) {
      await this.replacePageBlocks(pageId, markdownToNotionBlocks(input.markdown));
    }
  }

  async setEdgeEverIdOnPage(rawPageId: string, edgeEverId: string): Promise<void> {
    const pageId = normalizeNotionUuid(rawPageId);
    await this.ensureDatabaseSchema();
    await this.request(`/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [NOTION_PROP_EDGEEVER_ID]: {
            rich_text: [{ type: "text", text: { content: edgeEverId } }],
          },
        },
      }),
    });
  }

  async archivePage(rawPageId: string, archived = true): Promise<void> {
    const pageId = normalizeNotionUuid(rawPageId);
    await this.request(
      `/pages/${pageId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ archived }),
      },
      true,
    );
  }

  async findPageByEdgeEverId(edgeEverId: string): Promise<string | null> {
    await this.ensureDatabaseSchema();
    const res = await this.request<{ results: Array<{ id: string }> }>(
      `/databases/${this.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 1,
          filter: {
            property: NOTION_PROP_EDGEEVER_ID,
            rich_text: { equals: edgeEverId },
          },
        }),
      },
    );
    const first = res?.results?.[0];
    return first ? normalizeNotionUuid(first.id) : null;
  }

  async queryDatabasePage(startCursor?: string | null, pageSize = 25): Promise<{
    pages: Array<{ id: string }>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    await this.ensureDatabaseSchema();
    const res = await this.request<{
      results: Array<{ id: string; archived?: boolean; in_trash?: boolean }>;
      has_more: boolean;
      next_cursor: string | null;
    }>(`/databases/${this.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: pageSize,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });

    return {
      pages: (res?.results ?? [])
        .filter((row) => !row.archived && !row.in_trash)
        .map((row) => ({ id: normalizeNotionUuid(row.id) })),
      hasMore: Boolean(res?.has_more && res.next_cursor),
      nextCursor: res?.has_more ? (res.next_cursor ?? null) : null,
    };
  }

  async getPageSnapshot(rawPageId: string): Promise<NotionPageSnapshot | null> {
    const pageId = normalizeNotionUuid(rawPageId);
    const page = await this.request<Record<string, any>>(`/pages/${pageId}`, {}, true);
    if (!page) return null;

    const props = (page.properties ?? {}) as Record<string, any>;
    let title = "Untitled";
    for (const prop of Object.values(props)) {
      if (prop?.type === "title") {
        title = extractPlainText(prop.title) || "Untitled";
        break;
      }
    }

    const tags: string[] = Array.isArray(props[NOTION_PROP_TAGS]?.multi_select)
      ? props[NOTION_PROP_TAGS].multi_select
          .map((item: { name?: string }) => item.name?.trim() ?? "")
          .filter(Boolean)
      : [];

    const notebookName: string = props[NOTION_PROP_NOTEBOOK]?.select?.name?.trim() ?? "";
    const isPinned = Boolean(props[NOTION_PROP_PINNED]?.checkbox);
    const edgeEverId = extractPlainText(props[NOTION_PROP_EDGEEVER_ID]?.rich_text) || null;

    const rawDbId = page.parent?.database_id as string | undefined;
    const parentDatabaseId = rawDbId ? normalizeNotionUuid(rawDbId) : null;
    const archived = Boolean(page.archived);
    const inTrash = Boolean(page.in_trash);

    const blocks = archived || inTrash ? [] : await this.listAllBlocks(pageId);

    return {
      id: pageId,
      parentDatabaseId,
      archived,
      inTrash,
      title,
      tags,
      notebookName,
      isPinned,
      edgeEverId,
      markdown: notionBlocksToMarkdown(blocks),
      lastEditedTime: String(page.last_edited_time ?? new Date().toISOString()),
    };
  }

  private async listAllBlocks(blockId: string): Promise<NotionBlockPayload[]> {
    const blocks: NotionBlockPayload[] = [];
    let cursor: string | undefined;

    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const res = await this.request<{
        results: NotionBlockPayload[];
        has_more: boolean;
        next_cursor: string | null;
      }>(`/blocks/${blockId}/children?${query.toString()}`);

      blocks.push(...(res?.results ?? []));
      cursor = res?.has_more && res.next_cursor ? res.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }

  private async appendBlocks(blockId: string, children: NotionBlockPayload[]): Promise<void> {
    if (children.length === 0) return;
    await this.request(`/blocks/${blockId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children }),
    });
  }

  private async replacePageBlocks(pageId: string, nextBlocks: NotionBlockPayload[]): Promise<void> {
    const existing = await this.listAllBlocks(pageId);
    const concurrency = 4;
    for (let i = 0; i < existing.length; i += concurrency) {
      const slice = existing.slice(i, i + concurrency);
      await Promise.all(
        slice.map((block) =>
          block.id
            ? this.request(`/blocks/${block.id}`, { method: "DELETE" }, true)
            : Promise.resolve(null),
        ),
      );
    }

    for (let offset = 0; offset < nextBlocks.length; offset += BLOCK_BATCH_SIZE) {
      await this.appendBlocks(pageId, nextBlocks.slice(offset, offset + BLOCK_BATCH_SIZE));
    }
  }
}
