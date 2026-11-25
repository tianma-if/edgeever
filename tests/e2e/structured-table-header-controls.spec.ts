import { expect, test, type Page } from "@playwright/test";
import {
  createTableBaseDocument,
  getTableViews,
  markdownToDoc,
  parseTableBaseDocument,
  saveTableViews,
  serializeTableBaseDocument,
  tableBaseFallbackMarkdown,
  tableBaseTableDocument,
  type LegacyTableDocument,
} from "@edgeever/shared";

const table: LegacyTableDocument = {
  schemaVersion: 1,
  fields: [
    { id: "fld_title", name: "标题", type: "text" },
    { id: "fld_status", name: "状态", type: "select", options: ["未开始", "完成"] },
    { id: "fld_tags", name: "标签", type: "multiSelect", options: ["重要", "紧急"] },
    { id: "fld_due", name: "截止", type: "date" },
  ],
  records: [
    { id: "rec_1", cells: { fld_title: "甲", fld_status: "未开始", fld_tags: ["重要"], fld_due: "2026-12-02" } },
    { id: "rec_2", cells: { fld_title: "乙", fld_status: "完成", fld_tags: [], fld_due: null } },
  ],
  view: { filters: [], sort: null },
};

const openMemo = async (page: Page, memo: { id: string; title: string }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全部笔记", exact: true }).click();
  await page.getByPlaceholder("搜索笔记").fill(memo.title);
  await page.locator(`[data-memo-id="${memo.id}"] button`).first().click();
};

const flushSyncQueue = async (page: Page) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed")));
};

test("the fields panel reorders, hides and edits fields while the header only resizes", async ({ page }) => {
  const { notebooks } = await (await page.request.get("/api/v1/notebooks")).json();
  const base = createTableBaseDocument({ tables: [{ id: "tbl_tasks", name: "任务", document: saveTableViews(table, getTableViews(table)) }] });
  const created = await page.request.post("/api/v1/memos", {
    data: {
      notebookId: notebooks[0].id,
      title: `多维表格字段配置 ${Date.now()}`,
      contentMarkdown: serializeTableBaseDocument(base),
      contentJson: markdownToDoc(tableBaseFallbackMarkdown(base)),
    },
  });
  const { memo } = await created.json();

  const persisted = async (predicate: (view: ReturnType<typeof getTableViews>[number], document: LegacyTableDocument) => boolean, label: string) => {
    await expect.poll(async () => {
      await flushSyncQueue(page);
      const response = await page.request.get(`/api/v1/memos/${memo.id}`);
      if (!response.ok()) return false;
      const { memo: current } = await response.json();
      const parsedBase = parseTableBaseDocument(current.contentMarkdown ?? "");
      const firstTable = parsedBase?.tables[0];
      const parsed = firstTable ? tableBaseTableDocument(firstTable) : null;
      if (!parsed) return false;
      const view = getTableViews(parsed)[0];
      return Boolean(view && predicate(view, parsed));
    }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(true);
    expect(label.length).toBeGreaterThan(0);
  };

  try {
    await openMemo(page, memo);
    const grid = page.locator('[data-testid="base-grid"]');
    await expect(grid).toBeVisible();
    const headerNames = async () => (await grid.locator("thead tr th span.truncate").allInnerTexts()).filter(Boolean);
    expect(await headerNames()).toEqual(["标题", "状态", "标签", "截止"]);

    // 表头不再提供拖拽手柄
    await expect(grid.locator('[data-testid="column-drag-handle"]')).toHaveCount(0);

    // 字段配置里拖动「标签」到「标题」之前
    await page.getByRole("button", { name: "字段配置", exact: true }).click();
    const rows = page.locator('[data-testid="field-panel-row"]');
    await expect(rows).toHaveCount(4);
    // 手柄与编辑按钮平时不可见，悬浮到行上才出现
    const tagRow = page.locator('[data-testid="field-panel-row"][data-field-id="fld_tags"]');
    const tagGrip = tagRow.locator('[data-testid="field-panel-grip"]');
    const tagEdit = tagRow.locator('[data-testid="field-panel-edit"]');
    await expect(tagGrip).toHaveCSS("opacity", "0");
    await expect(tagEdit).toHaveCSS("opacity", "0");
    await tagRow.hover();
    await expect(tagGrip).toHaveCSS("opacity", "1");
    await expect(tagEdit).toHaveCSS("opacity", "1");

    // 整行任意位置都能拖，不必抓手柄
    const targetRow = page.locator('[data-testid="field-panel-row"][data-field-id="fld_title"]');
    // 等弹层入场动画结束，否则按下时行还在位移，落点会偏
    await expect.poll(async () => {
      const first = await tagRow.boundingBox();
      await page.waitForTimeout(80);
      const second = await tagRow.boundingBox();
      return first && second && first.x === second.x && first.y === second.y;
    }, { timeout: 5_000 }).toBe(true);
    const sourceBox = await tagRow.boundingBox();
    const targetBox = await targetRow.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const sourceX = sourceBox!.x + sourceBox!.width / 2;
    await page.mouse.move(sourceX, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceX - 6, sourceBox!.y + sourceBox!.height / 2 - 6, { steps: 3 });
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await rows.locator("span.truncate").allInnerTexts()).join(","), { timeout: 10_000 })
      .toBe("标题,标签,状态,截止");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect.poll(async () => (await headerNames()).join(","), { timeout: 10_000 }).toBe("标题,标签,状态,截止");
    await persisted((view) => view.columns?.map((column) => column.fieldId).join(",") === "fld_title,fld_tags,fld_status,fld_due", "column order");

    // 字段配置行可直接编辑字段：悬浮后点编辑按钮，取消后回到字段配置面板
    await page.getByRole("button", { name: "字段配置", exact: true }).click();
    const dueRow = page.locator('[data-testid="field-panel-row"][data-field-id="fld_due"]');
    await dueRow.hover();
    await dueRow.locator('[data-testid="field-panel-edit"]').click();
    await expect(page.locator('[data-testid="field-panel-row"]')).toHaveCount(0);
    await page.getByRole("dialog").filter({ has: page.getByText("编辑字段", { exact: true }) })
      .getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator('[data-testid="field-panel-row"]')).toHaveCount(4);
    // 点行内名字也能直接进编辑（轻点不算拖拽）
    await page.locator('[data-testid="field-panel-row"][data-field-id="fld_due"]').locator("button").first().click();
    const fieldDialog = page.getByRole("dialog").filter({ has: page.getByText("编辑字段", { exact: true }) });
    await expect(fieldDialog).toBeVisible();
    const nameInput = fieldDialog.getByLabel("字段标题");
    await expect(nameInput).toHaveValue("截止");
    await nameInput.fill("截止日");
    await fieldDialog.getByRole("button", { name: "确定", exact: true }).click();
    // 确定后回到字段配置面板，而不是跳出到表格
    await expect(page.locator('[data-testid="field-panel-row"]')).toHaveCount(4);
    await expect.poll(async () => (await headerNames()).join(","), { timeout: 10_000 }).toBe("标题,标签,状态,截止日");
    await persisted((_, document) => document.fields.some((field) => field.id === "fld_due" && field.name === "截止日"), "field rename");

    // 隐藏列仍在同一个字段配置里完成
    await page.getByRole("checkbox", { name: "标签", exact: true }).uncheck();
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect.poll(async () => (await headerNames()).join(","), { timeout: 10_000 }).toBe("标题,状态,截止日");
    await persisted((view) => view.columns?.some((column) => column.fieldId === "fld_tags" && column.hidden), "hidden column");

    // 表头右边缘仍可拖拽调宽
    const handle = grid.locator('[data-testid="column-resize-handle"]').nth(1);
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
    await page.mouse.up();
    await persisted((view) => view.columns?.find((column) => column.fieldId === "fld_status")?.width === 220, "column width");

    // 重新打开仍然保留顺序、重命名、隐藏与列宽
    await page.reload();
    await openMemo(page, memo);
    await expect(grid).toBeVisible();
    expect(await headerNames()).toEqual(["标题", "状态", "截止日"]);
    const width = await grid.locator("colgroup col").nth(2).evaluate((node) => (node as HTMLElement).style.width);
    expect(width).toBe("220px");
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`).catch(() => undefined);
  }
});