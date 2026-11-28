# 多维表格 Base：列顺序在字段配置里拖动、列宽在表头拖边缘

## 问题与目标

原来调整列顺序要进「字段配置」对话框里点上下箭头，一列一列挪，改一次顺序要点开菜单、打开对话框、按若干次「上移」再确认。列宽也只能在对话框里填数字。

对照飞书后重新定了做法：**列顺序、隐藏、编辑都在「字段配置」面板里完成**（面板每行可拖动排序、点击字段名直接编辑、取消勾选即隐藏），**表头本身不参与拖拽排序**；列宽在表头右边缘拖动调整（飞书网格同样支持拖列边界改宽），面板里不再放列宽输入框。

## 允许的变更与验收

- 「字段配置」面板（`apps/web/src/components/TableViewControls.tsx` 的 `fields` 模式）重写为行式列表：
  - 每行：左侧拖拽手柄（`GripVertical`，`data-testid="field-panel-grip"`）+ 显示勾选框（`aria-label` 为字段名，首列禁用）+ 字段类型图标 + 字段名 +（单表编辑器）列宽输入。
  - 手柄与右侧铅笔按钮默认隐藏（`opacity-0`），鼠标悬浮到该行才淡入；光标整行都是 `cursor-grab`。
  - **整行任意位置都能拖**：`pointerdown` 落在行的空白、图标或字段名上都开始拖拽（勾选框、列宽输入、铅笔按钮除外），在 `window` 上挂 `pointermove` / `pointerup`，按各行中线判断落点，松手时把源列插到目标位置；首列是索引列，永远排在最前。落点行高亮为天蓝底。
  - 轻点（位移 < 4px）整行等于「编辑这个字段」：按下时 `preventDefault` 吞掉了原生 click，所以在 `pointerup` 里按位移判断是拖拽还是点击，点击则关闭面板并打开字段对话框（改名/改类型/选项颜色都在那里）；键盘 Tab 到字段名按回车同样打开。
  - 主列不可隐藏、不可被移走；上下移动按钮与列宽输入在 Base 路径移除（`showColumnWidth={false}`），单表编辑器 `TableEditorPane` 仍保留列宽输入（它没有表头拖边缘的能力）。
- 表头（`apps/web/src/components/base/BaseTableGrid.tsx`）：删除拖拽排序手柄与 `dragstart/drop` 逻辑；保留右边缘拖拽热区（`role="separator"`、`aria-label="调整「{{name}}」列宽"`、`data-testid="column-resize-handle"`），拖动实时预览、松手提交一次。
- 共享层（`packages/shared/src/table-view.ts`）保留 `setTableViewColumnWidth(fields, view, fieldId, width)`（四舍五入、夹在 80–600、非法值返回原对象），删除 `moveTableViewColumn`（排序改在 UI 的草稿列数组里完成，点「应用」时才整体提交）。
- 九种语言 i18n：新增 `fieldsHint`（「拖动左侧手柄调整顺序，点击字段名可编辑，取消勾选即可隐藏」）、`resizeColumn`、`tableErrors`、`editField`；删除 `moveColumnLeft`、`moveColumnRight`、`moveUp`、`moveDown`。
- 列顺序与列宽仍写进**当前视图**的 `columns`（`BaseEditorPane.commitActiveView` → `saveTableViews`），保存仍走本地优先队列与 revision/contentHash/editSession 冲突保护。

## 保持不变

存储结构不变（`edgeever-base-v1:` 外层 + 嵌套 `edgeever-table-v1:`），无新增 D1 表、无迁移，`schemaVersion` 仍为 4；筛选/排序/分组/五种视图/记录面板/CSV/撤销重做/选项颜色不变；单表编辑器 `TableEditorPane` 的字段配置面板只是少了上下移动按钮，列宽输入与内联编辑保留。

## 完成核对

- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`（0 warnings / 0 errors）、`bun run build:web` 全部通过。
- 共享单测：`table.test.mjs` 的 `describe("view column width")` 覆盖宽度夹取与未知字段；i18n 8 pass。
- E2E `tests/e2e/structured-table-header-controls.spec.ts` 重写：断言表头不再有拖拽手柄 → 在字段配置里用真实鼠标把「标签」拖到首位 → 点「应用」后表头顺序与服务端 `view.columns` 均为 `标题,标签,状态,截止` → 面板里点「编辑字段 截止」改名为「截止日」并落库 → 勾掉「标签」隐藏并落库 → 拖表头右边缘 +60px 得 220px → 刷新重开后顺序、改名、隐藏、列宽全部保留。
- 回归 E2E：`structured-table-base`、`structured-table-base-fields`、`structured-table-mvp`、`structured-table-virtual-grid`、`structured-table-image-preview`、`structured-table-option-colors` 全部通过。
- 未覆盖：移动端触屏拖拽、拖到列表滚动区外侧自动滚动、多选批量隐藏。
