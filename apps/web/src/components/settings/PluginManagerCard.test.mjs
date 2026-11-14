import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./PluginManagerCard.tsx", import.meta.url), "utf8");
const catalogCard = readFileSync(new URL("../plugins/PluginCatalogCard.tsx", import.meta.url), "utf8");

describe("plugin manager card layout", () => {
  test("uses one responsive grid for marketplace and installed extension cards", () => {
    expect(source).toContain('const PLUGIN_CARD_GRID_CLASS_NAME = "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3";');
    expect(source.match(/className=\{PLUGIN_CARD_GRID_CLASS_NAME\}/g)).toHaveLength(1);
    expect(source).toContain("buildPluginCatalogItems");
    expect(source).toContain("<PluginCatalogCard");
    expect(source).not.toContain("md:grid-cols-2");
  });

  test("does not dump every plugin panel onto marketplace cards", () => {
    expect(catalogCard).not.toContain("onOpenPanel");
    expect(catalogCard).toContain("isPluginCardCommand");
    expect(catalogCard).toContain("commands.filter(isPluginCardCommand)");
  });

  test("does not present informational capability declarations as plugin permissions", () => {
    expect(source).not.toContain("plugins.details.permissions");
    expect(source).not.toContain("manifest.permissions.map");
    expect(catalogCard).not.toContain("manifest.permissions");
  });

  test("uses GitHub icon links for marketplace and installed extension repositories", () => {
    expect(catalogCard.match(/<GitHubRepositoryLink/g)).toHaveLength(1);
    expect(catalogCard).toContain("showTooltip={false}");
    expect(catalogCard).toContain("getPluginCatalogRepositoryUrl(item)");
  });

  test("keeps marketplace description below the title row instead of beside header actions", () => {
    expect(source).toContain("{t(\"plugins.syncDescription\")}");
    expect(source).toContain('<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">');
    expect(source).toContain('<p className="text-xs leading-5 text-slate-500">{t("plugins.syncDescription")}</p>');
    expect(source).not.toContain("flex items-start justify-between gap-3");
  });

  test("shows update checks when marketplace plugins exist without installed extensions", () => {
    expect(source).toContain("snapshot.extensions.length > 0 || (marketplaceQuery.data?.entries.length ?? 0) > 0");
    expect(source).not.toContain("{snapshot.extensions.length > 0 ? (\n              <Button");
  });

  test("does not treat a single plugin update error as a total check failure", () => {
    expect(source).toContain("checkErrors.length === snapshot.extensions.length");
    expect(source).not.toContain("refreshedMarketplace.data?.resolutionErrors ?? {}");
  });

  test("shows a retryable error instead of silently hiding a failed marketplace", () => {
    expect(source).toContain("marketplaceQuery.isError");
    expect(source).toContain('t("plugins.marketplace.loadFailed"');
    expect(source).toContain("marketplaceQuery.refetch()");
  });
});

test("shows per-plugin restore errors with a retry instead of an empty installed list", () => {
  expect(source).toContain("snapshot.catalogErrors.length > 0");
  expect(source).toContain('t("plugins.restoreFailed")');
  expect(source).toContain("failure.message");
  expect(source).toContain("host.syncFromCatalog()");
});

describe("unified plugin catalog cards", () => {
  test("uses one card component for official, community, and sideloaded plugins", () => {
    expect(catalogCard).toContain("getPluginCatalogSourceKey");
    expect(catalogCard).toContain("officialAutoUpdate");
    expect(catalogCard).toContain("canReplaceWithVerifiedMarketplace");
    expect(catalogCard).toContain('role={extension ? "link" : undefined}');
    expect(catalogCard).not.toContain("marketplace.installed");
    expect(source).not.toContain("border-emerald-100");
  });

  test("does not treat official marketplace plugins as community plugins in the trust dialog", () => {
    expect(source).toContain("getPluginCatalogSourceKey(catalogItem) === \"official\"");
    expect(source).toContain("isOfficial:");
  });
});
