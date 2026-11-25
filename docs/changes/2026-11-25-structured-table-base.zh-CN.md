# 多维表格 Base：一份文档多张表、五种视图与 17 种字段

## 问题与目标

单表结构化表格能覆盖轻量录入，但与飞书多维表格的使用方式差距明显：需要一份文档里放多张数据表、同一份数据要在表格/看板/日历/画册/甘特之间切换、字段类型要覆盖进度/评分/货币这类业务场景，并且每个视图能独立保存列显隐、列宽与分组。目标是引入独立的「Base」文档与编辑器，承载这些能力，同时**不改动**现有单表 `TableDocument` 的存储与读取路径，避免回归到已经上线的表格笔记。

## 允许的变更与验收

- 新增 Base 文档模型（`packages/shared/src/table-base.ts`）：`schemaVersion: 4`，marker `edgeever-base-v1:`（marker 在前、可读 Markdown 在后），最多 20 张表；每张表的 `content` 是既有的 `edgeever-table-v1:` 标记文本，因此单表解析、序列化、CSV、视图、视图升级逻辑全部复用，不需要第二套表模型。无法解析或版本不符时返回 `null`，调用方回退到单表编辑器或 Markdown。
- Web 端新增 Base 编辑器（`apps/web/src/components/base/`）：左侧数据表列表（新建/重命名/删除，上限 20 张，可整列收起把宽度让给网格）、顶部标题与保存态、导出/导入 CSV、添加字段、添加记录；主区复用 `TableViewControls` 的视图 tab 与筛选/排序/字段配置/分组对话框；视图布局支持表格、看板、日历、画册、甘特五种，每个视图独立保存列显隐与列宽、分组字段与方向、布局。
- 记录交互：网格虚拟化（32px 行高、行号列与操作列固定在两侧，状态与记录数不换行，窄窗口改为横向滚动），双击或操作按钮打开右侧记录面板编辑整条记录；右键菜单支持向上/向下插入行、复制记录、查看详情、删除记录；工具栏提供撤销/重做（最多 50 步，`Cmd/Ctrl+Z`、`Shift+Cmd/Ctrl+Z`、`Ctrl+Y`，在输入框内不劫持原生撤销）。
- 字段类型从 11 种扩到 17 种：新增创建时间 `createdTime`、最后更新时间 `updatedTime`、进度 `progress`（0–100）、评分 `rating`（0–5）、货币 `currency`、百分比 `percent`（存 0–1、显示百分比）。新增字段对话框按常规/业务/高级分组列出全部 17 种类型，带搜索框、分组标题与字段类型图标，可键盘输入过滤；单选/多选选项支持自定义颜色（`TABLE_OPTION_COLORS` 九色 + `optionColors` 持久化，未设置的选项按稳定哈希取色）。
- 系统时间字段在共享层计算（`packages/shared/src/table-base-compute.ts`）：`computeTableBase(base)` 按记录读取 `createdAt`/`updatedAt` 填进只读单元格，按浏览器本地时区渲染 `YYYY-MM-DD HH:mm`；计算字段不写库，写入会被拒绝，编辑器把它们渲染成只读单元格、记录面板里显示计算态。
- 兼容性：单表笔记（`edgeever-table-v1:`）仍进入原有 `TableEditorPane`，只有 `hasTableBaseDocumentMarker` 为真的笔记才进入 Base 编辑器；「新建表格」改为创建 Base（内含一张默认表）；公开表单接口改为白名单校验字段类型，自动编号、创建/修改时间等系统字段不对外暴露。
- 插件 API 的 `PluginTableFieldType` 与 `PluginTableCell` 同步新增类型；`/api/health` 汇报当前表格 schema 版本。

## 保持不变

存储仍是 memo 内容里的一段 base64url JSON 标记，不新增 D1 表结构、不做行级权限、评论、自动化与协同编辑；Base 内各数据表互不引用，只在同一 memo 内组织；单表上限仍是 40 字段 / 2,000 记录，Base 上限 20 张表；保存仍走 `repository.updateMemo` 的 revision/contentHash/editSession 冲突保护与 30 秒本地优先队列；移动端仍把结构化表格降级为只读表格。

## 完成核对

- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`（0 warnings / 0 errors）、`bun run build:web` 全部通过。
- 共享层单测：`table.test.mjs`、`table-base.test.mjs`、`table-base-compute.test.mjs` 共 44 条 / 262 断言全部通过；i18n catalog 8 条通过（九种语言键序一致）。
- 甘特图任务条：天数写在条内、记录标题排在条右侧，单日任务不再被截成单字；日历/画册/甘特在 1600×1000 视口下人工核对通过。
- 浏览器端 E2E（7 条，全部通过）：`structured-table-base.spec.ts`（多表切换、新建与重命名、分组、看板、记录面板、右键菜单增删改与撤销重做、重开持久化）、`structured-table-base-fields.spec.ts`（货币/进度/评分/百分比/时间字段渲染、字段对话框改类型与新增字段）、`structured-table-option-colors.spec.ts`（选项颜色落库与看板泳道同色）、`structured-table-header-controls.spec.ts`（字段配置面板拖拽排序、点击编辑、隐藏列，表头边缘改宽）、`structured-table-image-preview.spec.ts`（封面与缩略图走缩放预览）、`structured-table-mvp.spec.ts`、`structured-table-virtual-grid.spec.ts`。
- 未覆盖：Windows 安装版与桌面端、Cloudflare D1 远程实例、移动端 Base 只读展示、公开表单的选项颜色渲染、录制历史的 180 天保留策略。

## 后续修复 / Follow-up fixes

- 2026-11-25：看板/画册封面与网格附件缩略图改为缩放后的预览图（`apps/web/src/lib/image-preview.ts` + `apps/web/src/components/table/ResourceImage.tsx`），修掉大图封面导致的悬停长任务；见 `2026-11-25-structured-table-image-preview.zh-CN.md`。
- 2026-11-25：按使用反馈移除关联/查找引用/公式字段与整套仪表盘（做减法），系统时间字段改为本地时区渲染；见 `2026-11-25-structured-table-simplify.zh-CN.md`。
- 2026-11-25：单选/多选支持自定义颜色，甘特视图修复（记录不再因为缺少日期而消失），见 `2026-11-25-structured-table-option-colors.zh-CN.md`。
- 2026-11-25：列顺序与列宽改到「字段配置」面板里拖动整行排序、点击字段名编辑，表头只保留右边缘拖拽改宽；见 `2026-11-25-structured-table-header-controls.zh-CN.md`。
