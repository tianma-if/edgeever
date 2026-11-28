# 多维表格 Base：单选/多选选项自定义颜色与甘特修复

## 问题与目标

飞书多维表格里，单选/多选的每个选项都能单独配色，看板和分组头也用同一个颜色做视觉锚点。EdgeEver 的 Base 之前所有选项共用一种灰底胶囊，扫一眼分不出状态；同时甘特视图打开是坏的：主体显示未经翻译的 `structuredTable.emptyGrid` 键名，没填日期的记录整行消失。

目标是补齐「选项颜色」这条细节，让颜色在表格、看板、分组头、记录面板之间保持一致，并把甘特视图修到可用。

## 允许的变更与验收

- 共享模型（`packages/shared/src/table.ts`）新增 `TABLE_OPTION_COLORS`（blue / teal / green / yellow / orange / red / pink / purple / gray）、`TableOptionColor`、`TableField.optionColors`。`tableOptionColor(field, option)` 先读显式配色，没有则按选项名哈希落到固定颜色，因此**旧文档不需要迁移**也能立刻出现多种颜色。
- 写入侧校验：`normalizeTableField` 与 `parseField` 会丢弃不在 `options` 里的键和非法颜色值；`TableFieldPatch` 增加 `optionColors`，字段改成文本等其他类型时该配置自动消失。
- 字段对话框（`apps/web/src/components/base/BaseFieldDialog.tsx`）的选项编辑器从「逗号分隔文本框」换成逐行编辑：色块按钮 + 九色调色板、选项名输入、删除按钮、底部「添加选项」。新增选项时按调色板顺序轮转给默认色。
- 颜色在所有视图统一：`apps/web/src/components/table/option-pill.tsx` 提供 `OptionPill` 与 `optionDotClassName`，表格单元格、多选下拉、看板卡片胶囊、表格分组头色点、看板泳道圆点、记录面板下拉与多选标签都走同一份 `OPTION_TONES`。
- 记录面板的单选从一个原生下拉改成「胶囊 + 下拉菜单」，每个菜单项带色点，末尾提供「清除」；多选仍是复选组，但选项以彩色胶囊展示。
- 字段表头菜单在 Base 编辑器里收敛为「字段配置 / 删除字段」两项，名称、类型、选项、颜色统一在对话框里改（单表编辑器 `TableEditorPane` 仍保留内联编辑，因为它的字段类型少、没有颜色配置）。
- 甘特视图修复（`apps/web/src/components/base/BaseViews.tsx`）：空态改用 `structuredTable.noCards`；左侧列出**全部**记录，没有日期的记录标「未排期」而不是消失；有日期但时间轴上暂不可见时给出「给日期字段填上日期后，记录会排到这里」的提示；月份头改为 `2026-11`；日宽从 32px 收到 24px，窄编辑器里也能多看到两周。
- 九种语言的 i18n 新增 `optionColor`、`optionColors.*`（九色名）、`addOption`、`optionName`、`removeOption`、`editOptions`、`clearValue`、`selectPlaceholder`、`ganttDays`、`ganttUnscheduled`、`ganttHint`，并把 `fieldOptionsLabel` 从「选项（用逗号分隔）」改成「选项」。

## 保持不变

存储仍是 memo 内容里的 base64url 标记（`edgeever-base-v1:` / `edgeever-table-v1:`），没有新增 D1 表与迁移；`schemaVersion` 仍是 4；五种视图、列显隐与列宽、筛选/排序/分组、记录面板、右键插入/复制/删除、撤销重做、CSV 导入导出、封面预览缓存全部不变；保存仍走 revision / contentHash / editSession 冲突保护与本地优先队列。

## 完成核对

- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`（0 warnings / 0 errors，1864 files）、`bun run build:web` 全部通过。
- 共享层单测：`table.test.mjs` 新增「select option colors」4 条（round-trip、哈希兜底与显式覆盖、改类型后清空、坏数据被丢弃），32 pass / 153 expect；`i18n` 8 pass。
- 新增 E2E `tests/e2e/structured-table-option-colors.spec.ts`：网格胶囊按存储颜色渲染（紫色/橙色），字段对话框改色为蓝色后刷新仍生效，看板三条泳道圆点分别是 紫/橙/蓝，甘特视图 1 条已排期 + 2 条未排期且含「未排期」文案。
- 回归 E2E：`structured-table-base`（26.8s）、`structured-table-base-fields`（12.3s）、`structured-table-mvp`（24.5s）通过；`structured-table-virtual-grid`、`structured-table-image-preview` 另跑通过。
- 未覆盖：公开表单页与移动端只读视图没有渲染选项颜色；调色板未做对比度校验；每字段选项上限仍是 50 个。
