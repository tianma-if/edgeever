# EdgeEver 插件开发（P0 预览版）

EdgeEver P0 扩展 API 支持受信任的客户端插件和无代码主题包。用户可以从已验证插件市场、公开 GitHub 仓库或 Manifest 地址安装扩展；扩展安装在当前设备，并且只在 EdgeEver 打开期间运行。当前预览版不包含定时或后台任务、Webhook、不受约束的 TipTap 扩展和严格的 JavaScript 沙箱。

## 安全模型

主题包只包含经过校验的 Manifest 和公开 Design Tokens，不执行 JavaScript。

客户端插件采用类似 Obsidian 的受信任代码模型。插件声明的权限会限制它通过 EdgeEver 插件上下文调用的 API，但插件模块本身仍运行在客户端 JavaScript 环境中。用户只能安装来自可信开发者的插件。

公开 API 不会向插件暴露 EdgeEver Repository、IndexedDB 数据库、Cloudflare Binding 或 React 内部状态。

## 插件 Manifest

```json
{
  "type": "plugin",
  "id": "com.example.recent-notes",
  "name": "Recent Notes",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Adds a command for recent notes.",
  "entry": "./main.js",
  "platforms": ["web", "desktop"],
  "permissions": ["notes:read", "editor:read", "ui:commands", "ui:notices", "ui:panels"]
}
```

Manifest 和 JavaScript 模块必须返回允许 EdgeEver 来源访问的 CORS 响应头。相对 `entry` 地址基于 Manifest 地址解析。

## 通过 GitHub 分发

开发者可以把公开 GitHub 仓库地址直接分享给用户。仓库默认分支根目录必须包含最新的 `manifest.json`，每个版本通过 GitHub Release 发布。Release Tag 使用 Manifest 中的版本号或带 `v` 前缀的版本号，例如 `1.2.0` 或 `v1.2.0`。

Release 必须上传以下资产：

```text
manifest.json
main.js
styles.css（可选）
```

GitHub 插件的 `entry` 固定为 `./main.js`，`main.js` 必须是无需相对模块导入的单文件 Bundle。EdgeEver 会读取默认分支 Manifest、查找相同版本的 Release、并行下载资产、验证 GitHub 提供的 SHA-256 Digest（如果存在），然后把验证后的包缓存到当前设备的 IndexedDB。`main.js` 上限为 5 MB，`styles.css` 上限为 1 MB。

EdgeEver 会在插件市场页面打开、窗口重新获得焦点及每 30 分钟检查一次更新，但不会静默安装。用户必须点击「更新」并确认；如果新版新增插件权限或网络域名，确认框会明确列出新增访问范围。GitHub 分发的 Release `manifest.json` 必须与默认分支中用于提示更新的 Manifest 完全一致，否则安装会被拒绝。市场安装只跟随 Registry 中已经验证的新版本。

升级采用可回滚切换：新旧版本的包会分别缓存；如果新版无法激活，EdgeEver 会恢复原 Manifest、原启用状态和上一版本代码，而不是留下一个被破坏或被停用的插件。

用户在独立的「插件市场」页面中粘贴以下地址即可自由安装，无需经过官方市场收录：

```text
https://github.com/owner/edgeever-plugin
```

目前仅支持公开 GitHub 仓库；私有仓库 Token 尚未开放。

## 已验证插件市场

插件市场是一个经过校验的 Registry，不接管插件所有权。Registry 为每个版本固定插件 ID、GitHub 仓库、版本号及 `manifest.json`/`main.js`/`styles.css` 的 SHA-256；安装时仍从开发者的 GitHub Release 或登记的公开地址下载，并再次核对校验和。

Registry 格式：

```json
{
  "registryVersion": "1",
  "updatedAt": "2026-08-16T00:00:00.000Z",
  "entries": [{
    "id": "com.example.recent-notes",
    "name": "Recent Notes",
    "description": "Shows recently updated notes.",
    "author": "Example",
    "category": "Productivity",
    "repositoryUrl": "https://github.com/example/edgeever-recent-notes",
    "distribution": {
      "type": "github",
      "repositoryUrl": "https://github.com/example/edgeever-recent-notes"
    },
    "verification": {
      "version": "1.0.0",
      "checksums": {
        "manifestJson": "<64 位 SHA-256>",
        "mainJs": "<64 位 SHA-256>"
      }
    }
  }]
}
```

市场安装显示“已验证”，GitHub 或 Manifest 自由安装会明确显示未经验证的来源，但 EdgeEver 不阻止用户安装。卸载插件时会同时删除本机缓存的全部插件版本、当前工作区的普通插件存储和 Secret Storage。

当前支持以下权限：

- `notes:read`
- `notes:write`
- `notes:delete`
- `templates:read`
- `templates:write`
- `metadata:read`
- `metadata:write`
- `resources:read`
- `resources:write`
- `network`
- `storage`
- `secrets`
- `editor:read`
- `editor:write`
- `ui:commands`
- `ui:navigation`
- `ui:notices`
- `ui:panels`
- `ui:embeds`

通过 `context.network.fetch()` 访问网络时，还必须在 Manifest 的 `networkHosts` 中声明目标域名。

## 插件入口

```js
export default {
  activate(context) {
    return context.commands.register({
      id: "count-recent-notes",
      title: "Count recent notes",
      async run() {
        const result = await context.notes.query({
          sort: "updated-desc",
          limit: 10
        });
        context.ui.showNotice(`${result.notes.length} recent notes`);
      }
    });
  }
};
```

TypeScript 项目可以从 `@edgeever/plugin-api` 导入类型与辅助函数：

```ts
import { definePlugin } from "@edgeever/plugin-api";

export default definePlugin({
  activate(context) {
    // 在这里注册命令和事件监听器。
  }
});
```

每次注册都会返回清理函数。插件停用时，宿主也会自动清理已注册的命令和事件。

### SDK 包

`@edgeever/plugin-api` 是可发布的 ESM 包，包含生成后的 JavaScript 和 TypeScript 声明。在 EdgeEver 仓库中修改公开契约后，需要重新构建：

```sh
bun run build:plugin-api
```

维护者可以在不发布的情况下检查最终公开包内容：

```sh
cd packages/plugin-api
npm pack --dry-run
```

构建后的包只包含 `dist/index.js`、`dist/index.d.ts`、README 和包元数据。插件项目应把 SDK 运行时辅助函数一并打入单文件 `main.js`，发布包中不能残留对 `@edgeever/plugin-api` 的运行时导入。

## 笔记 API

```ts
context.notes.query({ text, notebookId, tags, sort, limit, offset });
context.notes.queryContent({ text, notebookId, tags, sort, limit, offset });
context.notes.get(noteId);
context.notes.editMarkdown(noteId, { expectedRevision, expectedContentHash, edits });
context.notes.create({ notebookId, title, contentMarkdown, tags });
context.notes.update(noteId, { title, contentMarkdown, tags });
context.notes.delete(noteId, { permanent: false });
context.notes.move([noteId], notebookId);
context.notes.pin([noteId], true);
context.notes.restore(noteId);
context.notes.revisions.list(noteId);
context.notes.revisions.restore(noteId, revisionId);
context.notebooks.list();
context.notebooks.create({ name, parentId });
context.notebooks.update(notebookId, { name, parentId, sortOrder });
context.notebooks.delete(notebookId);
context.tags.list();
context.tags.rename("old", "new");
context.tags.delete("unused");
```

`notes.query()` 返回轻量摘要。当插件必须扫描多篇笔记的 Markdown 时，例如 Tasks 索引、日历、看板或 Linter，应使用 `notes.queryContent()`。两个接口每页最多返回 200 篇笔记；持续使用 `nextOffset` 翻页，直到它为 `null`。不需要正文时应优先使用摘要查询。

所有写入都经过 EdgeEver 的共享 Repository 和业务层，包括离线队列与桌面端适配器。插件不能直接访问具体存储实现。
`notes.update()` 同时需要 `notes:write` 和 `notes:read`，因为更新流程需要读取当前版本并会返回更新后的完整笔记；这可以避免写权限被间接用于读取笔记正文。
`notes.editMarkdown()` 同样需要这两项权限，并用 `notes.get()` 返回的 `revision` 与 `contentHash` 做乐观并发检查。它适合任务勾选、Linter 和索引维护等只修改 Markdown 局部内容的插件：

```ts
const note = await context.notes.get(noteId);
await context.notes.editMarkdown(noteId, {
  expectedRevision: note.revision,
  expectedContentHash: note.contentHash,
  edits: [
    { from: 2, to: 3, insert: "x" },
    { from: note.contentMarkdown.length, to: note.contentMarkdown.length, insert: "\n追加内容" }
  ]
});
```

编辑区间使用 JavaScript UTF-16 字符串偏移和半开区间 `[from, to)`。一次调用中的区间不得重叠、越界或切开 Unicode 代理对。笔记基线已经变化或当前编辑器存在未保存内容时，宿主拒绝写入并抛出带 `code: "NOTE_CONFLICT"` 的错误；插件应重新读取并要求用户重试。无效区间使用 `code: "INVALID_MARKDOWN_EDIT"`。SDK 导出 `PluginApiError` 和 `PluginApiErrorCode` 供 TypeScript 插件缩小错误类型。
读取笔记本和标签需要 `metadata:read`，修改笔记本和标签需要 `metadata:write`。

附件使用独立权限，并继续通过 Web/桌面端共用的 Repository 适配器执行：

```ts
context.resources.list(noteId); // resources:read
const blob = await context.resources.read(resourceId); // resources:read
context.resources.upload(noteId, file); // resources:write
context.resources.update(resourceId, { file, expectedContentHash });
context.resources.rename(resourceId, filename);
context.resources.delete(resourceId);
```

`resources.update()` 同时需要两项资源权限，并使用 `resources.list()` 返回的 `contentHash` 做乐观并发检查。基线过期时会抛出 `code: "RESOURCE_CONFLICT"` 的 `PluginApiError`。当前替换上限为 100 MiB，并要求资源已同步且设备在线。宿主会把新内容写入新的对象键，再有条件地切换数据库指针，因此被拒绝的更新不会损坏旧对象。

订阅 `note.*` 事件需要 `notes:read`，订阅 `tag.changed` 需要 `metadata:read`，订阅 `template.*` 需要 `templates:read`，订阅 `resource.*` 需要 `resources:read`。同步队列状态事件不包含笔记或元数据，因此无需额外读取权限。

通过 EdgeEver 正常 Repository 层成功完成的笔记、标签、模板和资源变更——无论来自用户操作还是插件操作——都会进入同一条插件事件流。`workspace.synced` 用于报告已完成的 Repository 同步；失败的变更不会发送成功事件。

## 模板 API

模板是工作区共享数据，而不是插件私有设置。读取模板需要 `templates:read`；创建和删除需要 `templates:write`；更新需要两者。套用模板会创建笔记，因此还需要 `notes:write`：

```ts
const template = await context.templates.create({
  name: "每日站会",
  contentMarkdown: "## 已完成\n\n## 下一步\n",
  tags: ["daily"]
});
await context.templates.update(template.id, { description: "团队同步" });
const note = await context.templates.use(template.id, notebookId);
context.events.on("template.updated", ({ template }) => console.log(template.name));
```

`templates.create({ noteId })` 可以从已有笔记生成模板，此时还需要 `notes:read`。插件也可以调用 `templates.list()` 和 `templates.delete(templateId)`。

## 宿主统一渲染的设置

插件可以在 Manifest 中声明设置，由 EdgeEver 在插件详情页统一渲染。目前支持 `text`、`secret`、`number`、`boolean` 和 `select`：

```json
{
  "settings": {
    "fields": [
      { "key": "endpoint", "type": "text", "label": "API Endpoint", "required": true },
      { "key": "token", "type": "secret", "label": "API Token", "required": true },
      { "key": "format", "type": "select", "label": "格式", "default": "md", "options": [
        { "value": "md", "label": "Markdown" },
        { "value": "html", "label": "HTML" }
      ] }
    ]
  }
}
```

插件通过 `context.settings` 读取校验后的值。Secret 会加密保存在当前设备的 Secret Storage 中，禁止在 Manifest 中声明默认明文，也不会回填到设置表单：

```ts
const endpoint = await context.settings.get("endpoint");
const token = await context.settings.get("token");
await context.settings.set("format", "html");
await context.settings.remove("token");
```

## 插件存储与网络

插件存储按照 EdgeEver 工作区和插件 ID 隔离：

```ts
await context.storage.set("cursor", "next-page");
const cursor = await context.storage.get<string>("cursor");
```

网络请求只能使用 HTTPS；本地开发允许 localhost HTTP，并且目标域名必须提前声明：

```json
{
  "permissions": ["network"],
  "networkHosts": ["api.example.com", "*.trusted.example.com"]
}
```

```ts
await context.network.fetch("https://api.example.com/items");
```

普通 `storage` 适合游标和偏好设置。API Key 等敏感字符串应使用 `secrets`：

```ts
await context.secrets.set("api-token", token);
const token = await context.secrets.get("api-token");
await context.secrets.remove("api-token");
```

Web 端按照工作区和插件 ID 隔离 Secret，并使用设备本地、不可导出的 WebCrypto 密钥进行 AES-GCM 加密，密文保存在 IndexedDB。它可以避免密钥以明文形式落盘，但由于 P0 插件是同页面受信任代码，不能防御恶意插件读取运行中的数据。

## 编辑器 API

`editor:read` 可以读取当前编辑器选区或完整实时文档，`editor:write` 可以替换选区、在光标处插入 Markdown，或对实时文档应用经过校验的 UTF-16 区间编辑：

```ts
const selection = await context.editor.getSelection();
if (selection && !selection.empty) {
  await context.editor.replaceSelection(selection.text.toUpperCase());
}
await context.editor.insertAtCursor("**Inserted by plugin**");

const document = await context.editor.getDocument();
if (document) {
  await context.editor.editMarkdown([
    { from: 0, to: 0, insert: "<!-- 已通过 linter 检查 -->\n" }
  ]);
}
```

没有打开可编辑笔记时，读取返回 `null`，写入会抛出错误。`editor.editMarkdown()` 使用与 `notes.editMarkdown()` 相同的区间校验，但操作当前内存中的文档，因此可以安全保留用户尚未保存的修改。插件修改会进入正常的编辑器事务和自动保存流程。

### 插件 Embed

`ui:embeds` 允许插件为自己的受约束块级 Embed 类型注册渲染器。插入 Embed 还需要 `editor:write`：

```ts
const disposeEmbed = context.editor.embeds.register({
  type: "drawing",
  async mount(container, embed) {
    const scene = await context.resources.read(embed.resourceId);
    // 在 container 中渲染与框架无关的预览。
    return () => container.replaceChildren();
  }
});

await context.editor.insertEmbed({
  type: "drawing",
  resourceId: sceneResource.id,
  previewResourceId: previewResource.id,
  title: "架构图",
  data: { mode: "view" }
});
```

宿主会分配 Embed ID 和插件 ID，因此插件不能冒充其他渲染器。Embed 元数据只能使用兼容 JSON 的值，且上限为 64 KiB。EdgeEver 会在 Markdown 中将通用节点保存为 `edgeever-plugin-embed` 围栏块。插件停用或不可用时，Web 和公开分享页面会显示稳定的降级内容，原生编辑器则通过“不支持内容”兼容路径无损保留原节点。插件不会获得原始 TipTap 编辑器或 Schema。

## 笔记导航

声明 `ui:navigation` 后，插件可以从任务、日历、索引或搜索面板打开一篇现有笔记：

```ts
await context.ui.openNote(noteId, { search: "- [ ] 发布版本" });
```

宿主会先确认笔记存在且未被删除，再切换到对应笔记本和编辑器。提供 `search` 后，EdgeEver 会打开笔记内搜索并显示第一个精确匹配。插件不需要也不能操作私有路由或 React 状态。

## 自定义面板

插件可以注册框架无关的 DOM 面板。用户从「插件市场」的已安装插件区域打开面板，关闭、停用或卸载插件时宿主会执行清理函数：

```ts
context.ui.panels.register({
  id: "dashboard",
  title: "Dashboard",
  presentation: "fullscreen",
  mount(container, { state, requestClose }) {
    const heading = document.createElement("h2");
    heading.textContent = "Plugin dashboard";
    container.append(heading);
    return () => heading.remove();
  },
  beforeClose() {
    return hasUnsavedDrawing
      ? { title: "绘图尚未保存", message: "仍要关闭吗？", confirmLabel: "关闭绘图" }
      : true;
  }
});

await context.ui.panels.open("dashboard", { state: { resourceId } });
```

`presentation` 可以使用 `dialog`（默认）或 `fullscreen`。`panels.open()` 只能打开调用插件自己注册的面板；可选 JSON 状态上限为 64 KiB，并通过挂载上下文传入。`beforeClose()` 可以返回 `true` 关闭、返回 `false` 保持打开，或返回由宿主显示确认框所需的文案。挂载上下文中的 `requestClose()` 同样会经过这项保护。

## 桌面端插件入口

启用插件后，桌面端左侧工作区快捷栏会显示统一的拼图入口。菜单按插件分组展示命令和面板，并在顶部保留最近使用的操作；“管理插件与主题”会直接打开独立插件市场页面。插件不会各自在工具栏占用一个图标。

## 主题 Manifest

主题是一种不包含代码的扩展包：

```json
{
  "type": "theme",
  "id": "com.example.theme",
  "name": "Example Theme",
  "version": "1.0.0",
  "themeApiVersion": "1",
  "modes": ["light", "dark"],
  "light": {
    "color.background": "#f8fafc",
    "color.surface": "#ffffff",
    "color.text": "#0f172a",
    "color.accent": "#16a06e"
  },
  "dark": {
    "color.background": "#0f172a",
    "color.surface": "#1e293b",
    "color.text": "#f8fafc",
    "color.accent": "#4ade80"
  }
}
```

`@edgeever/plugin-api` 会通过 `THEME_TOKEN_NAMES` 导出所有支持的 Token。未知 Token 会被拒绝，避免主题依赖私有 DOM 选择器。
颜色 Token 只接受 `#RRGGBB` 或 `#RRGGBBAA`，字体与尺寸 Token 同样使用受限格式。主题值不能包含选择器、远程资源或 CSS 函数。

## 仓库内示例

本地开发 EdgeEver 时，可以在独立的「插件市场」页面中安装：

- `/extensions/recent-notes/manifest.json`
- `/extensions/nord-emerald/manifest.json`

第一个示例演示笔记查询、选区替换、命令和自定义面板，第二个示例演示无代码主题 Token API。

## 当前限制

- 插件只安装在当前设备，不参与同步。
- 插件只在应用打开期间运行。
- 暂无 Cron、Webhook 接收端、后台运行环境、市场投稿后台和自动审核流水线。
- 权限声明属于 API 能力检查，不是针对受信任 JavaScript 的严格沙箱。
- 自定义面板可以从桌面端统一插件菜单或插件管理页打开，尚未支持固定到主导航或编辑器侧栏。
- Secret Storage 仅保存在当前设备，不会同步到其他设备。
