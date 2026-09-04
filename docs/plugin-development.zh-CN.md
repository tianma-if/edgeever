# EdgeEver 插件开发（P0 预览版）

EdgeEver P0 扩展 API 支持受信任的客户端插件和无代码主题包。用户可以从已验证插件市场、公开 GitHub 仓库或 Manifest 地址安装扩展；扩展安装在当前设备，并且只在 EdgeEver 打开期间运行。桌面端用户可以为已注册的插件命令设置定时计划，并在 EdgeEver 运行期间执行。当前预览版不包含 Webhook、服务端常驻后台运行时、不受约束的 TipTap 扩展和严格的 JavaScript 沙箱。

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
- `schedules`
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

## 定时任务 API

桌面插件可以持久化定时执行自己的已注册命令。Manifest 需要同时声明 `ui:commands` 和 `schedules`，先注册命令，再用稳定的插件内计划键调用 `upsert()`：

```js
export default {
  async activate(context) {
    context.commands.register({
      id: "refresh-feeds",
      title: "刷新订阅源",
      async run() {
        // 只要桌面端保持运行，插件命令就可以执行耗时任务。
      }
    });

    await context.schedules.upsert({
      key: "hourly-refresh",
      name: "每小时刷新订阅源",
      commandId: "refresh-feeds",
      cronExpression: "0 * * * *",
      missedRunPolicy: "run-once"
    });
  }
};
```

`upsert()` 以“插件 ID + 计划键”为幂等标识，因此插件每次激活时调用也不会重复创建。第一台创建计划的桌面设备会保持为执行设备；同一插件在另一台电脑激活时只更新同一份计划定义，不会抢走执行权。省略 `isEnabled` 会保留用户的启停选择。插件可以通过 `context.schedules.list()` 查看自己的计划，并用 `context.schedules.remove(key)` 删除。

执行中心只保留最近 30 天的定时任务执行记录。过期记录会在升级时立即清理，并在后续执行或查看记录时持续物理删除。

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

插件可以在 Manifest 中声明设置，由 EdgeEver 在插件详情的独立「插件设置」页面统一渲染。已安装插件卡片和插件工具菜单均可直达该页面；未声明配置项的插件不显示设置入口，停用的插件仍可配置。设置仅保存在当前设备。默认行为和凭据应放在设置中，实际操作使用插件命令或功能面板，无需为普通配置另建面板。目前支持 `text`、`secret`、`number`、`boolean` 和 `select`：

设置 Schema 有意保持为声明式结构。字段布局、控件、间距、校验、响应式行为、无障碍、保存状态和密钥呈现均由 EdgeEver 管理；Manifest 中的 HTML、组件、CSS class、内联样式、颜色、字体以及自定义设置页导航等展示属性会被忽略。插件决定“配置什么”，而不是“设置页长什么样”。授权、连通性测试、数据迁移、索引重建等复杂流程应使用命令或命名清晰的功能面板，不要在自定义面板中重复实现普通设置。

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
- 桌面插件可以持久化定时执行自己的已注册命令，用户则可以在插件页面管理这些计划并分页查看执行记录。计划通过工作区同步、绑定一台桌面设备，并且只在该设备运行 EdgeEver 时执行；错过的计划可以选择跳过，或在恢复后合并补跑一次。这不是服务端常驻后台运行时。
- 暂无 Webhook 接收端、服务端后台运行环境、市场投稿后台和自动审核流水线。
- 权限声明属于 API 能力检查，不是针对受信任 JavaScript 的严格沙箱。
- 自定义面板可以从桌面端统一插件菜单或插件管理页打开，尚未支持固定到主导航或编辑器侧栏。
- Secret Storage 仅保存在当前设备，不会同步到其他设备。

## 通用 AI 与公开网络能力（尚未发布）

插件可声明 `ai:generate` 调用当前工作区的默认 AI 模型。接口只接受普通提示词；来源解析、业务流程和提示词属于插件，凭据保留在宿主。

```ts
const status = await context.ai.status(); // { configured, modelName? }
const result = await context.ai.generate({
  system: "把给定文本翻译成英文。",
  prompt: "用户提供的文本",
  maxOutputTokens: 1000,
  signal: controller.signal,
});
```

`system` 最多 8,000 字符，`prompt` 最多 90,000 字符，输出最多 5,000 token，生成最长 120 秒。后端要求交互式用户会话，公开演示模式禁用 AI，供应商错误脱敏。每个后端实例对每工作区的 AI 调用设置四路并发保护，不是分布式配额。模型费用沿用已配置供应商的计费；停用插件会中止其调用。

已有 `network.fetch(url, init)` 保留浏览器 fetch 行为，受 CORS 限制并省略凭据。使用通用公开网络传输时，需要同时声明 `network`、`network:public` 和 `networkHosts`，并显式选择 `transport: "public"`：

```json
{
  "permissions": ["network", "network:public"],
  "networkHosts": ["example.org"]
}
```

```ts
const response = await context.network.fetch("https://example.org/feed.xml", {
  transport: "public",
  headers: { Accept: "application/rss+xml" },
  redirect: "manual",
  signal: controller.signal,
});
const feed = await response.text(); // 插件自己解析。
```

公开模式仅支持 443 端口的 HTTPS GET／HEAD，不携带请求体和凭据；超时 20 秒，解码后的响应正文最多 2,000,000 字节。重定向只返回、不跟随（`redirect: "error"` 会拒绝）。来源的 403／429 保留为来源状态，不绕过平台访问限制。允许的请求头为 Accept、Accept-Language、If-None-Match、If-Modified-Since、Range；仅返回内容／缓存元数据、Location 和 Retry-After，不返回 Set-Cookie。响应在上限内缓冲，不是无限流式代理。

宿主在不改变插件 API 的前提下选择成本最低的安全传输。Web 先尝试浏览器请求：CORS 可读的响应完全留在客户端；只有浏览器以网络／CORS `TypeError` 拒绝时，才回退到已认证的后端中继。桌面端通过 Electron 主进程和用户本机网络请求，最多四路并发，不再把公开内容转发到 EdgeEver 后端。取消信号会传递到所有传输路径。

桌面端、自托管与云端驱动共用同一策略包。桌面端和 Bun 自托管会校验全部 DNS 结果，并把已校验地址直接交给 TLS；私网、特殊用途和混合公私地址全部拒绝。Cloudflare 回退使用 workerd 默认的仅公开 Internet 出口，不使用私网服务绑定。VPN／fake-IP DNS 返回的保留地址也会拒绝，不应禁用检查；非标准 workerd 部署须保留仅公开网络出口。Web 回退返回有大小限制的二进制正文，不再使用 Base64 JSON，避免 Base64 的额外传输体积。

插件权限和域名检查在可信客户端宿主执行。后端独立要求用户认证并限制仅公开网络，不信任客户端提交的插件 ID 或白名单，也不声称提供服务端证明的插件隔离；仍遵循可信 JavaScript 边界。后端不接收来源枚举、搜索时间范围、证据结构或报告流程。
