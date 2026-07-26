import type { LoginDeviceSession } from "@edgeever/shared";

export type LoginDeviceSessionRow = {
  id: string;
  device_id: string | null;
  user_agent: string | null;
  device_label: string | null;
  ip_address: string | null;
  ip_country: string | null;
  ip_region: string | null;
  expires_at: string;
  created_at: string;
  last_seen_at: string | null;
};

export const resolveSessionDeviceId = (
  requestedDeviceId: string | undefined,
  userAgent: string | null,
  sessionId: string,
) => requestedDeviceId ?? (userAgent?.trim() ? `legacy-ua:${userAgent}` : `legacy-session:${sessionId}`);

export const groupLoginDeviceSessions = (
  rows: LoginDeviceSessionRow[],
  currentSessionId: string,
): LoginDeviceSession[] => {
  const grouped = new Map<
    string,
    { representative: LoginDeviceSessionRow; createdAt: string; lastSeenAt: string }
  >();

  for (const row of rows) {
    const key = row.device_id ?? `session:${row.id}`;
    const lastSeenAt = row.last_seen_at ?? row.created_at;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, { representative: row, createdAt: row.created_at, lastSeenAt });
      continue;
    }

    if (row.created_at < existing.createdAt) existing.createdAt = row.created_at;
    if (lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = lastSeenAt;
    if (row.id === currentSessionId) existing.representative = row;
  }

  return [...grouped.values()].map(({ representative, createdAt, lastSeenAt }) => ({
    id: representative.id,
    userAgent: representative.user_agent,
    label: representative.device_label,
    ipAddress: representative.ip_address,
    ipCountry: representative.ip_country,
    ipRegion: representative.ip_region,
    isCurrent: representative.id === currentSessionId,
    createdAt,
    lastSeenAt,
    expiresAt: representative.expires_at,
  }));
};
