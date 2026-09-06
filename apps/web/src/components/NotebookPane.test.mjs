import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./NotebookPane.tsx", import.meta.url), "utf8");

test("keeps proactive AI out of primary navigation", () => {
  const primaryNav = source.split('aria-label={t("companion.primaryNavigation")}>')[1]?.split("</nav>")[0];
  expect(primaryNav).toContain('label={t("notebookPane.allMemos")}');
  expect(primaryNav).not.toContain('label={t("companion.navTitle")}');
  expect(primaryNav).not.toContain("onClick={onOpenCompanion}");
});

test("keeps the desktop create-note control compact with one neutral outline", () => {
  expect(source).toContain('rounded-2xl border border-slate-200/90');
  expect(source).toContain('className="group flex h-12');
  expect(source).toContain('className="group relative flex h-12 w-[6.25rem]');
  expect(source).toContain('before:inset-y-2.5');
  expect(source).toContain('data-[state=open]:bg-emerald-50');
  expect(source).toContain('t("diagram.moreTypes")');
  expect(source).toContain('group-data-[state=open]:rotate-180');
  expect(source).not.toContain('focus-visible:ring-inset focus-visible:ring-emerald-500');
  expect(source).not.toContain('title={t("notebookPane.newMemo")}');
});

test("marks diagram note types as beta without labeling regular notes", () => {
  const createTypeMenu = source.split('<DropdownMenuContent align="start" sideOffset={8} className="w-52">')[1]?.split("</DropdownMenuContent>")[0];
  const regularNoteItem = createTypeMenu?.split('onSelect={() => onCreateMemo()}>')[1]?.split("</DropdownMenuItem>")[0];
  const betaBadgeCount = createTypeMenu?.match(/<DiagramBetaBadge \/>/g)?.length;

  expect(regularNoteItem).not.toContain("DiagramBetaBadge");
  expect(createTypeMenu).toContain('onCreateMemo("architecture")');
  expect(betaBadgeCount).toBe(3);
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
