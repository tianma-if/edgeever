import { parseExtensionManifest, type ExtensionManifest, type MarketplaceEntry, type PluginPermission } from "@edgeever/plugin-api";
import type { InstalledExtension } from "@/lib/plugins/plugin-host";
import { loadGithubRepositoryManifest } from "@/lib/plugins/github-plugin-distribution";
import { isVersionOutdated } from "@/lib/version-check";

export interface PluginUpdateInfo {
  pluginId: string;
  currentVersion: string;
  latestVersion: string;
  latestManifest: ExtensionManifest;
  addedPermissions: PluginPermission[];
  addedNetworkHosts: string[];
  marketplaceEntry?: MarketplaceEntry;
}

export interface PluginUpdateCheckResult {
  updates: PluginUpdateInfo[];
  errors: Record<string, string>;
}

const fetchManifest = async (url: string, request: typeof fetch) => {
  const response = await request(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
  return parseExtensionManifest(await response.json());
};

const loadMarketplaceManifest = async (entry: MarketplaceEntry, request: typeof fetch) => {
  if (entry.distribution.type === "github") {
    return (await loadGithubRepositoryManifest(entry.distribution.repositoryUrl, request)).manifest;
  }
  return fetchManifest(entry.distribution.manifestUrl, request);
};

const assertCompatibleUpdate = (extension: InstalledExtension, manifest: ExtensionManifest) => {
  if (manifest.id !== extension.manifest.id) throw new Error("Update manifest plugin id does not match the installed extension.");
  if (manifest.type !== extension.manifest.type) throw new Error("Update manifest type does not match the installed extension.");
};

const addedValues = <T extends string>(current: readonly T[] | undefined, latest: readonly T[] | undefined) => {
  const existing = new Set(current ?? []);
  return [...new Set(latest ?? [])].filter((value) => !existing.has(value));
};

export const checkInstalledExtensionUpdate = async (
  extension: InstalledExtension,
  marketplaceEntries: MarketplaceEntry[],
  request: typeof fetch = window.fetch.bind(window),
): Promise<PluginUpdateInfo | null> => {
  const marketplaceEntry = extension.source.kind === "marketplace"
    ? marketplaceEntries.find((entry) => entry.id === extension.manifest.id)
    : undefined;

  let latestManifest: ExtensionManifest;
  if (extension.source.kind === "marketplace") {
    if (!marketplaceEntry || !isVersionOutdated(extension.manifest.version, marketplaceEntry.verification.version)) return null;
    latestManifest = await loadMarketplaceManifest(marketplaceEntry, request);
    if (latestManifest.version !== marketplaceEntry.verification.version) {
      throw new Error("Marketplace version does not match the distributed manifest.");
    }
  } else if (extension.source.kind === "github") {
    if (!extension.source.repositoryUrl) throw new Error("Installed GitHub extension is missing its repository URL.");
    latestManifest = (await loadGithubRepositoryManifest(extension.source.repositoryUrl, request)).manifest;
  } else {
    latestManifest = await fetchManifest(extension.manifestUrl, request);
  }

  assertCompatibleUpdate(extension, latestManifest);
  if (!isVersionOutdated(extension.manifest.version, latestManifest.version)) return null;

  const currentPlugin = extension.manifest.type === "plugin" ? extension.manifest : null;
  const latestPlugin = latestManifest.type === "plugin" ? latestManifest : null;
  return {
    pluginId: extension.manifest.id,
    currentVersion: extension.manifest.version,
    latestVersion: latestManifest.version,
    latestManifest,
    addedPermissions: addedValues(currentPlugin?.permissions, latestPlugin?.permissions),
    addedNetworkHosts: addedValues(currentPlugin?.networkHosts, latestPlugin?.networkHosts),
    ...(marketplaceEntry ? { marketplaceEntry } : {}),
  };
};

export const checkPluginUpdates = async (
  extensions: InstalledExtension[],
  marketplaceEntries: MarketplaceEntry[],
  request: typeof fetch = window.fetch.bind(window),
): Promise<PluginUpdateCheckResult> => {
  const settled = await Promise.allSettled(
    extensions.map((extension) => checkInstalledExtensionUpdate(extension, marketplaceEntries, request))
  );
  const updates: PluginUpdateInfo[] = [];
  const errors: Record<string, string> = {};
  settled.forEach((result, index) => {
    const pluginId = extensions[index]?.manifest.id;
    if (!pluginId) return;
    if (result.status === "fulfilled") {
      if (result.value) updates.push(result.value);
      return;
    }
    errors[pluginId] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });
  return { updates, errors };
};
