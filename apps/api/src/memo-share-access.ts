import { isoNow } from "./entity-utils";
import type { DatabaseAdapter } from "./storage-contract";

/** Expiry is decided on the server only; stored values are normalized UTC ISO strings. */
export const isMemoShareExpired = (expiresAt: string | null | undefined, now = isoNow()) =>
  Boolean(expiresAt) && (expiresAt as string) <= now;

/** Counts note content served to a visitor. A failed write never blocks reading the note. */
export const recordMemoShareView = async (db: DatabaseAdapter, token: string) => {
  try {
    await db.prepare(
      `UPDATE memo_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE token = ?`
    ).bind(isoNow(), token).run();
  } catch (error) {
    console.warn("Could not record a shared note view", error);
  }
};
