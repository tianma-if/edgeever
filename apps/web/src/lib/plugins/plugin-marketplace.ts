import { createRequestCache } from "@/lib/request-cache";
import { getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { parseMarketplaceRegistry, type MarketplaceEntry, type MarketplaceRegistry } from "@edgeever/plugin-api";
import {
  downloadGithubExtension,
  loadGithubInstallableManifest,
  type GithubAssetDownloader,
} from "@/lib/plugins/github-plugin-distribution";
import { isVersionOutdated } from "@/lib/version-check";
import { resolveAppAssetUrl } from "@/lib/app-page-path";

export const DEFAULT_PLUGIN_REGISTRY_URL = "extensions/registry.json";

export const loadPluginMarketplace = async (
  registryUrl = DEFAULT_PLUGIN_REGISTRY_URL,
  request: typeof fetch = window.fetch.bind(window),
  baseUrl = import.meta.env.BASE_URL,
  locationHref = globalThis.window?.location?.href ?? "http://localhost/",
): Promise<MarketplaceRegistry> => {
  const url = resolveAppAssetUrl(registryUrl, baseUrl, locationHref);
  const response = await request(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Plugin marketplace request failed with HTTP ${response.status}.`);
  return parseMarketplaceRegistry(await response.json());
};

export interface ResolvedPluginMarketplace extends MarketplaceRegistry {
  resolutionErrors: Record<string, string>;
}

const withManifestMetadata = (
  entry: MarketplaceEntry,
  manifest: Awaited<ReturnType<typeof loadGithubInstallableManifest>>["manifest"],
): MarketplaceEntry => ({
  ...entry,
  name: manifest.name,
  description: manifest.description ?? entry.description,
  locales: manifest.locales,
});

const resolveOfficialGithubEntry = async (
  entry: MarketplaceEntry,
  request: typeof fetch,
  downloadAssetBytes?: GithubAssetDownloader,
): Promise<MarketplaceEntry> => {
  if (entry.publisher !== "edgeever" || entry.distribution.type !== "github") return entry;
  const live = await loadGithubInstallableManifest(entry.distribution.repositoryUrl, request);
  if (live.manifest.id !== entry.id) {
    throw new Error("Official repository manifest id does not match the marketplace entry.");
  }
  if (isVersionOutdated(live.manifest.version, entry.verification.version)) {
    throw new Error("Official repository version is older than the marketplace verified version.");
  }
  if (live.manifest.version === entry.verification.version && entry.verification.checksums?.manifestJson) {
    return withManifestMetadata(entry, live.manifest);
  }
  const downloaded = await downloadGithubExtension(entry.distribution.repositoryUrl, request, downloadAssetBytes);
  if (downloaded.manifest.id !== entry.id) {
    throw new Error("Official repository manifest id does not match the marketplace entry.");
  }
  if (isVersionOutdated(downloaded.manifest.version, entry.verification.version)) {
    throw new Error("Official repository version is older than the marketplace verified version.");
  }
  if (!downloaded.checksums.manifestJson) throw new Error("Official extension release is missing a manifest checksum.");
  if (downloaded.manifest.type === "plugin" && !downloaded.checksums.mainJs) {
    throw new Error("Official plugin release is missing a main.js checksum.");
  }
  return withManifestMetadata({
    ...entry,
    verification: {
      version: downloaded.manifest.version,
      checksums: downloaded.checksums,
    },
  }, downloaded.manifest);
};

export const resolveOfficialPluginMarketplace = async (
  registry: MarketplaceRegistry,
  request: typeof fetch = window.fetch.bind(window),
  downloadAssetBytes?: GithubAssetDownloader,
): Promise<ResolvedPluginMarketplace> => {
  const settled = await Promise.allSettled(
    registry.entries.map((entry) => resolveOfficialGithubEntry(entry, request, downloadAssetBytes)),
  );
  const resolutionErrors: Record<string, string> = {};
  const entries = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const entry = registry.entries[index];
    if (!entry) throw result.reason;
    resolutionErrors[entry.id] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return entry;
  });
  return { ...registry, entries, resolutionErrors };
};

const defaultMarketplaceFetch: typeof fetch = (input, init) => window.fetch(input, init);
const marketplaceCaches = new WeakMap<typeof fetch, Map<GithubAssetDownloader | undefined, ReturnType<typeof createRequestCache<ResolvedPluginMarketplace>>>>();

export const loadResolvedPluginMarketplace = (
  registryUrl = DEFAULT_PLUGIN_REGISTRY_URL,
  request: typeof fetch = defaultMarketplaceFetch,
  downloadAssetBytes?: GithubAssetDownloader,
  force = false,
) => {
  const cacheIdentity = request === defaultMarketplaceFetch ? window.fetch : request;
  let caches = marketplaceCaches.get(cacheIdentity);
  if (!caches) { caches = new Map(); marketplaceCaches.set(cacheIdentity, caches); }
  let cached = caches.get(downloadAssetBytes);
  if (!cached) { cached = createRequestCache<ResolvedPluginMarketplace>({ ttlMs: 60_000 }); caches.set(downloadAssetBytes, cached); }
  const key = JSON.stringify([resolveAppAssetUrl(registryUrl, import.meta.env.BASE_URL, globalThis.window?.location?.href ?? "http://localhost/"), getConfiguredDesktopApiBaseUrl()]);
  return cached(key, async () => {
    const result = await resolveOfficialPluginMarketplace(await loadPluginMarketplace(registryUrl, request), request, downloadAssetBytes);
    // Do not retain failures as successful stale marketplace resolutions.
    if (Object.keys(result.resolutionErrors).length > 0) {
      throw new MarketplaceResolutionError(result);
    }
    return result;
  }, force).catch(error => {
    if (error instanceof MarketplaceResolutionError) return error.result;
    throw error;
  });
};

class MarketplaceResolutionError extends Error {
  constructor(readonly result: ResolvedPluginMarketplace) { super("Plugin marketplace resolution incomplete"); }
}
