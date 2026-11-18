import type { Bindings } from "./api-context";
import { AppError } from "./app-error";
import { randomToken } from "./auth-crypto";
import { sha256 } from "./hash-utils";
import { decryptSecret, encryptSecret } from "./secret-encryption";

export type NotionEncryptionEnvironment = Pick<
  Bindings,
  | "EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY"
  | "EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS"
  | "EDGE_EVER_AUTH_PASSWORD"
  | "EDGE_EVER_AUTH_PASSWORD_HASH"
  | "EDGE_EVER_AUTH_PASSWORD_FALLBACK"
  | "EDGE_EVER_STORAGE_ENCRYPTION_KEY"
>;

const candidateKeys = (env: NotionEncryptionEnvironment, workspaceId: string): string[] =>
  [
    env.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY,
    env.EDGE_EVER_AUTH_PASSWORD,
    env.EDGE_EVER_AUTH_PASSWORD_HASH,
    env.EDGE_EVER_STORAGE_ENCRYPTION_KEY,
    env.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
    env.EDGE_EVER_AUTH_PASSWORD_FALLBACK,
  ].flatMap((secret) =>
    secret?.trim() ? [`edgeever:notion-sync:v1:${workspaceId}:${secret.trim()}`] : [],
  );

export const resolvePrimaryNotionEncryptionKey = (
  env: NotionEncryptionEnvironment,
  workspaceId: string,
): string | null =>
  candidateKeys(
    {
      ...env,
      EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: undefined,
      EDGE_EVER_AUTH_PASSWORD_FALLBACK: undefined,
    },
    workspaceId,
  )[0] ?? null;

export const encryptNotionSecret = async (
  plaintext: string,
  workspaceId: string,
  env: NotionEncryptionEnvironment,
): Promise<string> => {
  const key = resolvePrimaryNotionEncryptionKey(env, workspaceId);
  if (!key) {
    throw new AppError(
      "notion_encryption_unavailable",
      "Configure a deployment credential encryption key before saving Notion credentials.",
      503,
    );
  }
  return encryptSecret(plaintext, key);
};

export const decryptNotionSecret = async (
  encrypted: string | null | undefined,
  workspaceId: string,
  env: NotionEncryptionEnvironment,
): Promise<{ value: string; needsMigration: boolean } | null> => {
  if (!encrypted) return null;
  const keys = candidateKeys(env, workspaceId);
  for (let index = 0; index < keys.length; index += 1) {
    try {
      const value = await decryptSecret(encrypted, keys[index]!);
      return { value, needsMigration: index > 0 };
    } catch {
      // Try next rotation fallback key.
    }
  }
  return null;
};

export const createNotionWebhookChannelToken = (): string => `nwh_${randomToken(24)}`;

export const extractNotionDatabaseUuid = (input: string): string | null => {
  const withoutQuery = input.trim().split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
  const match = withoutQuery.match(
    /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i,
  );
  if (!match?.[1]) return null;
  const hex = match[1].replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const normalizeNotionUuid = (id: string): string =>
  extractNotionDatabaseUuid(id) ?? id.trim().toLowerCase();

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const signNotionWebhookBody = async (
  secret: string,
  rawBody: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return `sha256=${toHex(signature)}`;
};

export const timingSafeEqualText = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
};

export const verifyNotionWebhookSignature = async (
  secret: string,
  signatureHeader: string | null | undefined,
  rawBody: string,
): Promise<boolean> => {
  if (!secret || !signatureHeader) return false;
  const expected = await signNotionWebhookBody(secret, rawBody);
  return timingSafeEqualText(signatureHeader.trim(), expected);
};

export type NormalizedNotionNoteSnapshot = {
  title: string;
  markdown: string;
  tags: string[];
  notebookName: string;
  isPinned: boolean;
};

export const computeNotionSnapshotHash = async (
  snapshot: NormalizedNotionNoteSnapshot,
): Promise<string> => {
  const normalizedMarkdown = snapshot.markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
  const normalizedTags = Array.from(
    new Set(snapshot.tags.map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean)),
  ).sort();

  return sha256(
    JSON.stringify({
      title: snapshot.title.trim() || "Untitled",
      markdown: normalizedMarkdown,
      tags: normalizedTags,
      notebookName: snapshot.notebookName.trim(),
      isPinned: Boolean(snapshot.isPinned),
    }),
  );
};
