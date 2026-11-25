# 多维表格 Base：移除关联/查找引用/公式字段与仪表盘

## 问题与目标

上一轮把飞书多维表格的「关系型」能力搬进了 Base：单向关联 `link`、查找引用 `lookup`、公式 `formula`，以及数据聚合用的仪表盘。实际使用下来，这些能力需要先理解跨表关系、引用语义和公式语法，属于典型的「功能加法带来认知负担」：用户只想要一张能录数据、能切视图、封面不卡的表格。

目标是**做减法**：删掉关联/查找引用/公式三种字段与整套仪表盘，Base 回到「一份文档内多张互不引用的数据表 + 五种视图」的简单形态，同时不破坏已有笔记的读取与保存。

## 允许的变更与验收

- 字段类型从 20 种降到 17 种：移除 `link`、`lookup`、`formula`；保留 `text`、`number`、`checkbox`、`date`、`select`、`multiSelect`、`url`、`phone`、`email`、`attachment`、`autoNumber`、`createdTime`、`updatedTime`、`progress`、`rating`、`currency`、`percent`。新增字段对话框的「高级」分组只剩创建时间与最后更新时间。
- 共享层删除 `packages/shared/src/table-formula.ts`（公式解析/求值，546 行）及其测试；`packages/shared/src/table-base-compute.ts` 收缩为只填系统时间字段的实现，仍导出 `computeTableBase(base)` / `computeTableRecords(base, tableId)` 与 `{ tables, errors }` 形状，调用方无需改签名。
- `packages/shared/src/table.ts` 删除 `TableFieldLink`/`TableFieldLookup`/`TableFieldFormula`、`TABLE_LINK_LIMIT`、`TABLE_FORMULA_EXPRESSION_LIMIT`、`cleanTableFieldLink`/`cleanTableFieldLookup`/`cleanTableFieldFormula`、`cleanLinkValues`、`computedCellDisplayText` 与各处的类型分支；`TABLE_COMPUTED_FIELD_TYPES` 只剩 `createdTime`/`updatedTime`；`TableFieldPatch` 收窄为 `name`/`type`/`options`。
- 视图与操作：`TABLE_VIEW_OPERATORS` 去掉三种类型的空值操作符；`table-operations.ts` 不再有 link 单元格校验分支；插件 API 的 `PluginTableFieldType` 同步收窄。
- 删除仪表盘：`packages/shared/src/table-dashboard.ts`、`apps/web/src/components/base/BaseDashboard.tsx`、`tests/e2e/structured-table-dashboard.spec.ts` 一并删除；`TableBaseDocument` 不再有 `dashboards` 字段，解析时忽略旧文档里的该字段（不报错）；左侧栏只保留数据表列表。
- 系统时间字段改为按**浏览器本地时区**渲染 `YYYY-MM-DD HH:mm`（此前直接展示 ISO 的 UTC 数字，对中国用户会差 8 小时）；无法解析的值原样返回。
- 九种语言的 i18n 目录同步删除对应 key（关联/查找/公式的标签、错误提示、类型名，以及仪表盘的 29 个 key），保持各语言键序与 en-US 一致。
- 兼容性：旧笔记里若已存在 `link`/`lookup`/`formula` 字段，解析时会被丢弃（未知类型按 `null` 字段处理），记录本身与其它字段不受影响；`dashboards` 同样被忽略。由于本次改动未改变 `TABLE_FIELD_TYPES` 之外的结构，单表笔记（`edgeever-table-v1:`）路径完全不受影响。

## 保持不变

存储仍是 memo 内容里的 base64url JSON 标记，无新增 D1 表与迁移；五种视图（表格/看板/日历/画册/甘特）、列显隐与列宽、筛选/排序/分组、记录面板、右键插入/复制/删除、撤销重做 50 步、CSV 导入导出、封面预览缓存全部保留；保存仍走 revision/contentHash/editSession 冲突保护与本地优先队列。

## 完成核对

- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`（0 warnings / 0 errors，1863 files）、`bun run build:web` 全部通过。
- 共享层单测：`table.test.mjs`、`table-base.test.mjs`、`table-base-compute.test.mjs`、`i18n` 全部通过（含「不再持久化系统时间值」「时间戳按本地时区渲染」等用例）。
- 浏览器端 E2E：`structured-table-base-fields.spec.ts` 重写为「货币/进度/评分/百分比/创建时间渲染 + 类型选择器里搜不到关联/查找引用/公式 + 新增评分字段 + 百分比改货币 + 重开保留」；`structured-table-base.spec.ts`（多表、视图、分组、看板、记录面板、右键菜单、撤销重做）、`structured-table-mvp.spec.ts`、`structured-table-virtual-grid.spec.ts`、`structured-table-image-preview.spec.ts` 全部通过。
- 未覆盖：Windows 安装版与桌面端、Cloudflare D1 远程实例、移动端 Base 只读展示；旧笔记里的关联/公式字段被静默丢弃，未提供迁移提示。
