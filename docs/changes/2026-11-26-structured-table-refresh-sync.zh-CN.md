# 刷新前先同步排队的本地改动

## 问题与目标

Web 客户端是本地优先的：保存一次文档只写入 IndexedDB 并把 `memo.update:<id>` 放进同步
队列，真正发往服务端的 `PATCH` 延后（`DEFERRED_MEMO_SYNC_DELAY_MS`，默认 30 秒）。而
「刷新」按钮在 `dirty` 为假时就认为没有待保存内容，直接读取服务端快照并覆盖本地文档。

于是出现这个可复现的缺陷：新建一张数据表 → 进入同步队列 → 点「刷新」→ 服务端快照还是
旧的一版 → 新表从界面上消失。浏览器整页刷新不受影响（本地镜像优先），所以只有点面板里
的「刷新」才会丢。单表编辑器 `TableEditorPane` 的刷新按钮有同样的潜在问题。

目标：刷新要么在拿到服务端快照之前把排队的改动送达，要么明确拒绝并保留本地文档，绝不
用旧快照覆盖尚未同步的编辑。

## 允许的变更与验收

- `apps/web/src/lib/sync-queue.ts` 新增两个导出：
  - `hasPendingMemoUpdate(memoId)`：查询 `syncQueue` 中该 memo 的 `memo.update:<id>` 记录；
  - `flushPendingMemoUpdate(memoId, { timeoutMs = 5000 })`：离线直接返回 `false`；否则触发
    `edgeever:sync-queue-changed` 让同步生命周期立刻跑队列，再每 150ms 轮询一次，直到队列
    记录消失或超时。
- `apps/web/src/components/base/BaseEditorPane.tsx` 与
  `apps/web/src/components/TableEditorPane.tsx` 的刷新函数在读取 `api.getMemo` 之前调用
  `flushPendingMemoUpdate(memo.id)`；返回 `false` 时写入
  `structuredTable.refreshPending` 提示并直接返回，本地文档保持不变。
- 九个语言文件在 `refreshError` 之后补 `structuredTable.refreshPending`。
- `tests/e2e/structured-table-base.spec.ts` 增加两处断言：①「新建第三张数据表」后点「刷新」仍
  是三张表且表头仍在（修复前会掉回两张）；②新增用例覆盖刷新前先送达排队改动、以及队列塞住
  （拦截 `PATCH`）时刷新只提示「还有改动没同步完成，稍后再刷新」且三张表都还在。

验收：新建数据表后立刻点「刷新」，表格不消失；服务端最终也会收到这次改动；离线或存在
冲突时刷新只提示、不改动本地内容。

## 保持不变

- 30 秒延迟同步策略、队列格式、冲突处理逻辑与离线行为。
- 浏览器整页刷新、切换文档、自动保存的既有语义。
- 面板布局、按钮位置与其它工具栏行为。

## 完成核对

- `bun run lint`：`Found 0 warnings and 0 errors.`（1866 个文件）
- `bun run typecheck`、`bun run typecheck:mobile`、`bun run build:web`：通过
- `bun test packages/shared/src/i18n`：8 通过（含顺序敏感的 catalog 比对）
- `tests/e2e/structured-table-base.spec.ts`：2 个用例通过（28.5s / 14.9s，含刷新同步与拒绝覆盖）
- 其余表格 E2E（base-fields、narrow、option-colors、header-controls、image-preview、mvp、
  virtual-grid）：通过

未验证：真机离线、同步冲突弹窗打开时的人工点击路径；自动化用拦截 `PATCH` 模拟队列无法送达，
并受 `isBrowserOffline()` 在回环地址下恒为假所限，未覆盖真实断网。
