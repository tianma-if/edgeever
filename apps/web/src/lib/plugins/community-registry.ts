import {
  mergeCommunityMarketplace,
  parseMarketplaceRegistry,
  rememberMarketplaceRevocations,
  type MarketplaceRegistry,
  type MarketplaceRevocation,
} from "@edgeever/plugin-api";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import {
  communityRegistryPublicKeys,
  decodeCommunityRegistryKey,
  verifyCommunityRegistrySignature,
} from "@/lib/plugins/community-registry-keys";
import {
  communityRegistryStorage,
  type CommunityRegistryStorage,
} from "@/lib/plugins/community-registry-store";
import {
  loadResolvedPluginMarketplace,
  type ResolvedPluginMarketplace,
} from "@/lib/plugins/plugin-marketplace";
import type { GithubAssetDownloader } from "@/lib/plugins/github-plugin-distribution";

export interface SignedCommunityRegistry {
  bytes: ArrayBuffer;
  signatureBase64: string;
}

export type CommunityCatalogStatus = "disabled" | "cached" | "refreshed" | "retained";

export interface DisplayPluginMarketplace extends ResolvedPluginMarketplace {
  revocations: MarketplaceRevocation[];
  community: CommunityCatalogStatus;
}

const textDecoder = new TextDecoder();

export const communityRegistryInstanceKey = () => {
  if (typeof window === "undefined") return "default";
  const configured = getConfiguredDesktopApiBaseUrl();
  return configured || window.location.origin;
};

export const encodeRegistryBytes = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const isNewerRegistryTimestamp = (candidate: string, current: string | null) => {
  if (!current) return true;
  const next = Date.parse(candidate);
  const previous = Date.parse(current);
  if (Number.isNaN(next) || Number.isNaN(previous)) return false;
  return next > previous;
};

const readRevocationsSafely = async (storage: CommunityRegistryStorage) => {
  try {
    return await storage.readRevocations();
  } catch {
    return [];
  }
};

const readVerifiedCachedRegistry = async (
  storage: CommunityRegistryStorage,
  instanceKey: string,
  publicKeys: readonly Uint8Array[],
) => {
  try {
    const cached = await storage.readRegistry(instanceKey);
    if (!cached) return null;
    const bytes = decodeCommunityRegistryKey(cached.registryBase64);
    const signature = decodeCommunityRegistryKey(cached.signatureBase64);
    if (!bytes || !signature) return null;
    if (!await verifyCommunityRegistrySignature(bytes, signature, publicKeys)) return null;
    return parseMarketplaceRegistry(JSON.parse(textDecoder.decode(bytes)) as unknown);
  } catch {
    return null;
  }
};

const composeDisplayMarketplace = (
  bundled: ResolvedPluginMarketplace,
  community: MarketplaceRegistry | null,
  revocations: readonly MarketplaceRevocation[],
  communityStatus: CommunityCatalogStatus,
): DisplayPluginMarketplace => {
  const revokedIds = new Set(revocations.map((item) => item.id));
  const merged = mergeCommunityMarketplace(bundled, community, revokedIds);
  const updatedAt = [bundled.updatedAt, community?.updatedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? bundled.updatedAt;
  return {
    ...bundled,
    entries: merged.entries,
    updatedAt,
    revocations: [...revocations],
    community: communityStatus,
  };
};

const fetchCommunityRegistryFromInstance = () => api.getCommunityPluginRegistry();

export const loadDisplayPluginMarketplace = async ({
  refreshCommunity = false,
  refreshOfficial = false,
  request,
  downloadAssetBytes,
  fetchCommunityRegistry = fetchCommunityRegistryFromInstance,
  storage = communityRegistryStorage(),
  publicKeys = communityRegistryPublicKeys(),
  instanceKey = communityRegistryInstanceKey(),
}: {
  refreshCommunity?: boolean;
  refreshOfficial?: boolean;
  request?: typeof fetch;
  downloadAssetBytes?: GithubAssetDownloader;
  fetchCommunityRegistry?: () => Promise<SignedCommunityRegistry | null>;
  storage?: CommunityRegistryStorage;
  publicKeys?: readonly Uint8Array[];
  instanceKey?: string;
} = {}): Promise<DisplayPluginMarketplace> => {
  const bundled = await loadResolvedPluginMarketplace(undefined, request, downloadAssetBytes, refreshOfficial);
  const revocations = await readRevocationsSafely(storage);
  const cached = () => readVerifiedCachedRegistry(storage, instanceKey, publicKeys);

  if (!refreshCommunity) {
    const community = await cached();
    return composeDisplayMarketplace(bundled, community, revocations, community ? "cached" : "disabled");
  }

  let remote: SignedCommunityRegistry | null;
  try {
    remote = await fetchCommunityRegistry();
  } catch {
    remote = null;
    const community = await cached();
    return composeDisplayMarketplace(bundled, community, revocations, "retained");
  }

  if (!remote) {
    return composeDisplayMarketplace(bundled, null, revocations, "disabled");
  }

  const bytes = new Uint8Array(remote.bytes);
  const signature = decodeCommunityRegistryKey(remote.signatureBase64);
  const signatureValid = signature
    ? await verifyCommunityRegistrySignature(bytes, signature, publicKeys)
    : false;
  if (!signatureValid || !signature) {
    const community = await cached();
    return composeDisplayMarketplace(bundled, community, revocations, "retained");
  }

  let parsed: MarketplaceRegistry;
  try {
    parsed = parseMarketplaceRegistry(JSON.parse(textDecoder.decode(bytes)) as unknown);
  } catch {
    const community = await cached();
    return composeDisplayMarketplace(bundled, community, revocations, "retained");
  }

  let cachedRecord: Awaited<ReturnType<CommunityRegistryStorage["readRegistry"]>> = null;
  try {
    cachedRecord = await storage.readRegistry(instanceKey);
  } catch {
    cachedRecord = null;
  }
  if (!isNewerRegistryTimestamp(parsed.updatedAt, cachedRecord?.updatedAt ?? null)) {
    const community = await cached();
    return composeDisplayMarketplace(bundled, community, revocations, "cached");
  }

  const nextRevocations = rememberMarketplaceRevocations(revocations, parsed.revocations ?? []);
  try {
    await storage.writeRevocations(nextRevocations);
    await storage.writeRegistry({
      instanceKey,
      registryBase64: encodeRegistryBytes(bytes),
      signatureBase64: remote.signatureBase64.trim(),
      updatedAt: parsed.updatedAt,
    });
  } catch {
    // The verified catalog can still be shown for this visit when storage is blocked.
  }
  return composeDisplayMarketplace(bundled, parsed, nextRevocations, "refreshed");
};
