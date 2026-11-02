import { expect, test, type Page } from "@playwright/test";

const storageKey = "edgeever.memoSort";
const modes = [
  ["updated-desc", "最近更新"],
  ["created-desc", "创建时间"],
  ["title-asc", "标题 A-Z"],
  ["title-desc", "标题 Z-A"],
] as const;

const openSort = async (page: Page) => {
  await page.getByRole("button", { name: "列表更多操作", exact: true }).click();
  return page.getByRole("menuitem", { name: /^排序：/ });
};

const chooseSort = async (page: Page, label: string) => {
  await (await openSort(page)).hover();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};

for (const [mode, label] of modes) {
  test(`remembers ${mode} when the workspace reopens`, async ({ page }) => {
    await page.goto("/");
    await chooseSort(page, label);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(mode);

    const requestedSorts: Array<string | null> = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/memos" && request.method() === "GET") {
        requestedSorts.push(url.searchParams.get("sort"));
      }
    });
    await page.reload();
    await expect(await openSort(page)).toHaveText(`排序：${label}`);
    // A populated local mirror can satisfy the list without an HTTP query.
    expect(requestedSorts.every(value => value === mode)).toBe(true);
  });
}

for (const stored of [null, "unknown-sort"]) {
  test(`keeps the default when the stored sort is ${stored === null ? "absent" : "invalid"}`, async ({ page }) => {
    await page.addInitScript(({ key, value }) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      localStorage.setItem("edgeever.notebookSort", "custom");
    }, { key: storageKey, value: stored });
    await page.goto("/");
    await expect(await openSort(page)).toHaveText("排序：最近更新");
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(stored);
    expect(await page.evaluate(() => localStorage.getItem("edgeever.notebookSort"))).toBe("custom");
  });
}

test("keeps in-session sorting usable when preference storage is blocked", async ({ page }) => {
  await page.addInitScript(key => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(name) {
      if (name === key) throw new DOMException("Blocked", "SecurityError");
      return get.call(this, name);
    };
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("Blocked", "SecurityError");
      set.call(this, name, value);
    };
  }, storageKey);
  await page.goto("/");
  await chooseSort(page, "标题 A-Z");
  await expect(await openSort(page)).toHaveText("排序：标题 A-Z");
  await page.reload();
  await expect(await openSort(page)).toHaveText("排序：最近更新");
});
