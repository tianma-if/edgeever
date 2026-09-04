import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./NotebookPane.tsx", import.meta.url), "utf8");

test("keeps proactive AI out of primary navigation", () => {
  const primaryNav = source.split('aria-label={t("companion.primaryNavigation")}>')[1]?.split("</nav>")[0];
  expect(primaryNav).toContain('label={t("notebookPane.allMemos")}');
  expect(primaryNav).not.toContain('label={t("companion.navTitle")}');
  expect(primaryNav).not.toContain("onClick={onOpenCompanion}");
});

describe("NotebookPane client downloads", () => {
  test("keeps macOS and Windows downloads visible in the desktop runtime", () => {
    expect(source).toContain('t("pwa.sidebarMac") || "macOS"');
    expect(source).toContain('t("pwa.sidebarWindows") || "Windows"');
    expect(source).not.toContain("!window.edgeeverDesktop?.isAvailable");
  });

  test("renders platform icons inline so desktop protocols do not break them", () => {
    expect(source).toContain("<BrandIcon path={APPLE_ICON_PATH}");
    expect(source).toContain("<BrandIcon path={WINDOWS_ICON_PATH}");
    expect(source).toContain("<GooglePlayIcon />");
    expect(source).toContain("<AppStoreIcon />");
    expect(source).not.toContain('src="/icons/platforms/');
  });
});
