# 多维表格移动端布局

## 问题与目标

窗口宽度小于 `md` 时 Web 客户端会切到手机外壳，但多维表格编辑器仍沿用桌面端头部：
抬头一行与视图工具条都是 `overflow-x-auto`，在 390px 屏幕上标题、保存状态、筛选和字段
工具会被推到屏幕外；行内操作只在 hover 时出现，触屏用户打不开记录面板；弹窗也可能超出
视口、把自己的按钮裁掉。

飞书移动端多维表格只保留一行标题栏，其余工具都收进菜单和浮层。目标与它一致：
**基础控件必须始终放得下**，只有表格本体允许横向滚动。

## 允许的变更与验收

- 新增 `apps/web/src/hooks/useCompactViewport.ts`，用 `(max-width: 767px)` 媒体查询导出
  `useCompactViewport()`；不改全局 CSS。
- `apps/web/src/components/base/BaseEditorPane.tsx` 在 `md` 以下渲染两行紧凑头部：第一行
  是返回、标题与 `⋯` 菜单（添加字段、添加记录、导出/导入 CSV、刷新、撤销/重做）；第二行
  是数据表选择器、视图选择器、保存状态或记录数、筛选开关、工具按钮。桌面头部不变。
- 工具按钮打开底部浮层，内含五种布局与四个字段工具（字段配置、筛选、分组、排序）。
  `TableViewControls` 新增 `compact` 属性，紧凑模式下只渲染弹窗，不再出现第二条可横滚的
  工具条。
- `ViewDialog` 与 `BaseFieldDialog` 加上 `max-h-[calc(100dvh-…)]`，小屏时自身滚动。
- `BaseTableGrid` / `BaseKanban` 新增 `compact`：行号变成打开记录面板的按钮，行尾操作不再
  只在 hover 时显示，看板卡片点任意位置即可打开记录；`BaseRecordPanel` 新增 `overlay`，
  在 `md` 以下覆盖在网格之上。
- 九个语言文件补 `structuredTable.more` 与 `structuredTable.tools`。
- `tests/e2e/structured-table-narrow.spec.ts` 新增一条手机用例：断言除表格本体外没有元素
  横向滚动；走一遍工具浮层；编辑字段后取消回到字段面板；切到看板；分别从卡片和行号打开
  记录面板。

验收：390px 下抬头与所有工具条都不横滚；桌面端的每个操作都有触屏入口；桌面布局不变。

## 保持不变

- 桌面端头部、工具条、键盘快捷键与保存链路。
- 表格本体在手机上仍横向滚动，与飞书移动端一致。
- Base 文档结构（`schemaVersion: 4`）、所有已存字段，以及单表编辑器。
- 字段权限、存储守卫与接口行为。

## 完成核对

- `bun run typecheck`、`bun run typecheck:mobile` 通过。
- `bun run lint` —— 0 warnings / 0 errors（1866 个文件）。
- `bun run build:web` 通过（生成 `dist/sw.js`）。
- `bun run test:bulk` —— 6049 pass / 5 fail；五条失败是本机环境基线（三条 web clipper
  仓库路径检查、一条非 ASCII 工作目录导致的语言包测试、一条缺 Electron 的桌面测试）。
- Playwright（Chrome 通道）：`structured-table-base`、`-base-fields`、`-narrow`（2 条）、
  `-mvp`、`-option-colors`、`-header-controls`、`-image-preview`、`-virtual-grid` 全部通过。

未验证：真机 iOS/Android 浏览器与 React Native 客户端；本次改动只覆盖 Web 端的紧凑布局。
