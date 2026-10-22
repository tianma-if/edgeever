import { FONT_IDS } from "./font-catalog";
import type { TiptapDoc, TiptapNode, TiptapTextNode } from "./content";
import type { PublicNoteProse } from "./note-prose";
import { parseMemoLinkHref } from "./note-links";
import type { NotebookSiteSettings } from "./notebook-site";

export type MemoShare = {
  memoId: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  passwordProtected: boolean;
  /** Plaintext is returned only immediately after the owner enables or regenerates a password. */
  password?: string;
};

export type ManagedMemoShare = MemoShare & {
  memoTitle: string | null;
  notebookId: string;
  notebookName: string | null;
};

export type NotebookShare = {
  siteSlug?: string | null;
  siteSettings?: NotebookSiteSettings;
  notebookId: string;
  notebookName: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  passwordProtected: boolean;
  /** Returned only when enabling or regenerating the password. */
  password?: string;
};

export type PublicNotebookShare = {
  siteSlug?: string | null;
  settings?: NotebookSiteSettings;
  notebookId: string;
  name: string;
  notebooks: Array<{ id: string; parentId: string | null; name: string }>;
  memos: Array<{ id: string; notebookId: string; title: string | null }>;
};

export type ShareBodyAccess = {
  resourceBasePath: string;
  memoUrls: Readonly<Record<string, string>>;
};

export const PUBLISHED_NOTE_BODY_FONTS = [
  "wenkai-screen", "neo-zhi-song", "source-serif", ...FONT_IDS,
] as const;

export type PublishedNoteBodyFont = (typeof PUBLISHED_NOTE_BODY_FONTS)[number];

export const parsePublishedNoteBodyFont = (
  value: unknown,
): PublishedNoteBodyFont | null =>
  typeof value === "string" &&
  (PUBLISHED_NOTE_BODY_FONTS as readonly string[]).includes(value)
    ? (value as PublishedNoteBodyFont)
    : null;

export type PublicMemoShare = {
  title: string | null;
  contentJson: TiptapDoc;
  contentMarkdown: string;
  tags: string[];
  updatedAt: string;
  memoShareTokens: Record<string, string>;
  /** Built-in face chosen by the author. Null keeps the system font and downloads nothing. */
  bodyFont: PublishedNoteBodyFont | null;
  /** Account reading settings for the article body. Column width stays on the author's editor. */
  prose: PublicNoteProse;
};

const RESOURCE_URL_PATTERN =
  /^\/api\/v1\/resources\/([^/?#]+)\/blob(?:[?#].*)?$/;

const rewriteAttributeValue = (
  value: unknown,
  token: string,
  memoShareTokens: Readonly<Record<string, string>>,
  access?: ShareBodyAccess,
) => {
  if (typeof value !== "string") return value;
  const match = value.match(RESOURCE_URL_PATTERN);
  if (match) {
    return `${access?.resourceBasePath ?? `/api/public/shares/${encodeURIComponent(token)}/resources`}/${encodeURIComponent(match[1])}/blob`;
  }

  const memoId = parseMemoLinkHref(value);
  if (memoId && access) return access.memoUrls[memoId] ?? "#";
  const shareToken = memoId ? memoShareTokens[memoId] : null;
  return shareToken ? `/share/${encodeURIComponent(shareToken)}` : value;
};

/** Rewrites EdgeEver-owned resources and publicly shared memo links for anonymous viewers. */
export const rewriteMemoResourcesForShare = (
  doc: TiptapDoc,
  token: string,
  memoShareTokens: Readonly<Record<string, string>> = {},
  access?: ShareBodyAccess,
): TiptapDoc => {
  const visit = (
    node: TiptapNode | TiptapTextNode,
  ): TiptapNode | TiptapTextNode => {
    const attrs =
      "attrs" in node && node.attrs
        ? Object.fromEntries(
            Object.entries(node.attrs).map(([key, value]) => [
              key,
              rewriteAttributeValue(value, token, memoShareTokens, access),
            ]),
          )
        : undefined;
    const marks =
      "marks" in node && node.marks
        ? node.marks
            .filter((mark) => {
              const memoId = parseMemoLinkHref(mark.attrs?.href);
              return !access || !memoId || Boolean(access.memoUrls[memoId]);
            })
            .map((mark) => ({
              ...mark,
              attrs: mark.attrs
                ? Object.fromEntries(
                    Object.entries(mark.attrs).map(([key, value]) => [
                      key,
                      rewriteAttributeValue(
                        value,
                        token,
                        memoShareTokens,
                        access,
                      ),
                    ]),
                  )
                : undefined,
            }))
        : undefined;

    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(marks ? { marks } : {}),
      ...("content" in node && node.content
        ? { content: node.content.map(visit) }
        : {}),
    } as TiptapNode | TiptapTextNode;
  };

  return visit(doc) as TiptapDoc;
};
