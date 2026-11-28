# 评审跟进：多维表格存储守卫、视图稳定性、表单资格与窄屏

## 问题与目标

结构化多维表格 PR 的首轮评审提出四个问题，另有作者本人发现的一个缺口：

1. **存储守卫（P1）**：`memo-service` 只识别单表标记。Base 把多张表包进新的编码文档，老客户端
   保存 Markdown 回退内容时会把整份 Base 覆盖成普通文本。
2. **视图稳定性（P2）**：`updateTableField` 只要被改字段与分组字段不同就重置看板，重命名无关
   文本列会把已保存的看板丢回表格。
3. **表单资格（P2）**：公开表单只渲染可提交字段，但提交路径只跳过 `autoNumber`，因此表单设置
   里残留的必填「创建时间 / 更新时间」会让每次提交都失败。
4. **窄屏（P2）**：数据表列表在 `md` 以下被隐藏，多表 Base 在手机上无法切换到其它表。
5. **移动端阅读**：移动端把 Base 当普通富文本，编辑后保存回退 Markdown 会丢掉 Base。

目标：让这五条路径与既有单表行为保持一致，并用「没有修复就会失败」的测试验证。

## 允许的变更与验收

- `packages/shared/src/table-base.ts` 新增 `stripTableBaseDocumentMarker` 与
  `listTableBaseAttachmentResourceIds`，仅新增导出，不改 schema。
- `packages/shared/src/table.ts` 把看板重置收窄为「分组字段不存在，或不再是单选」。
- `apps/api/src/memo-service.ts` 拒绝「丢弃既有 Base」的保存（`table_base_update_required`，409）
  与「携带坏 Base 标记」的保存（`invalid_table_base`，400），并回收被删除数据表释放的附件。
- `apps/api/src/mcp-tool-service.ts` 禁止通过 `update_memo` 替换 Base 内容。
- `apps/api/src/table-form-service.ts` 导出 `tableFormFieldIsSubmittable`，表单渲染与提交共用。
- `apps/web/src/components/base/BaseEditorPane.tsx` 在 `md` 以下提供紧凑的数据表选择器。
- `apps/mobile/src/lib/mobile-diagram.ts` 把 Base 投影成逐表 Markdown，详情页对其保持只读，
  与单表笔记一致。

验收：老客户端保存不会毁掉 Base；编辑无关字段保留已保存视图；表单字段变成系统字段后仍可提交；
手机宽度可以切换数据表；移动端能读到每张表且不暴露标记。

## 保持不变

- 单表标记、单表守卫与公开表单行为。
- Base 文档 schema（`schemaVersion: 4`）与全部既有键。
- Base 编辑仍然只在 Web 端；移动端对结构化内容保持只读，与单表笔记一致。

## 完成核对

- `bun run lint`：0 warnings / 0 errors（1865 个文件）。
- `bun run typecheck`、`bun run typecheck:mobile`：通过。
- `bun run build:web`：通过。
- `bun test packages/shared/src/table*.test.mjs apps/api/src/table-form-*.test.mjs apps/api/src/database-write-optimizations.test.mjs apps/mobile/src/lib/mobile-diagram.test.ts packages/shared/src/i18n`：102 pass / 0 fail。
- `bun run test:bulk`：6049 pass / 5 fail；五条为本机环境基线（三条 web clipper store 依赖检出路径、
  一条英文目录测试在中文工作目录失败、一条缺 Electron）。
- Playwright（Chrome）：`structured-table-base`、`-base-fields`、`-narrow`、`-mvp`、`-option-colors`、
  `-header-controls`、`-image-preview`、`-virtual-grid` 全部通过。

未验证：评审要求的「真实 D1 部署 + Docker SQLite 上的跨版本编辑/升级/回滚」需要两版客户端同时
在线，尚未执行。
