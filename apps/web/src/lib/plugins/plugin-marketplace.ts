import { parseMarketplaceRegistry, type MarketplaceRegistry } from "@edgeever/plugin-api";

export const DEFAULT_PLUGIN_REGISTRY_URL = "/extensions/registry.json";

export const loadPluginMarketplace = async (
  registryUrl = DEFAULT_PLUGIN_REGISTRY_URL,
  request: typeof fetch = window.fetch.bind(window)
): Promise<MarketplaceRegistry> => {
  const url = new URL(registryUrl, window.location.href);
  const response = await request(url.href, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Plugin marketplace request failed with HTTP ${response.status}.`);
  return parseMarketplaceRegistry(await response.json());
};
