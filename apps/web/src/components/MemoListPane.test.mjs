import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("memo context menu", () => {
  test("uses a Radix submenu for notebook moves so opening the picker does not close the menu", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("<DropdownMenuSub>");
    expect(source).toContain("<DropdownMenuSubTrigger");
    expect(source).toContain("<DropdownMenuSubContent");
    expect(source).not.toContain("contextMoveOpen");
  });
});

describe("desktop memo list spacing", () => {
  test("reserves matching desktop scrollbar gutters on both sides", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("lg:px-0 lg:pb-3 lg:[scrollbar-gutter:stable_both-edges]");
  });
});
