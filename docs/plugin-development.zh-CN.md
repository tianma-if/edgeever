# EdgeEver 插件开发（P0 预览版）

EdgeEver P0 扩展 API 支持受信任的客户端插件和无代码主题包。用户可以从已验证插件市场、公开 GitHub 仓库或 Manifest 地址安装扩展；扩展安装在当前设备，并且只在 EdgeEver 打开期间运行。当前预览版不包含定时或后台任务、Webhook、自定义编辑器 Block 和严格的 JavaScript 沙箱。

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

市场安装显示“已验证”，GitHub 或 Manifest 自由安装会明确显示未经验证的来源，但 EdgeEver 不阻止用户安装。卸载插件时会同时删除本机缓存的插件包。

当前支持以下权限：

- `notes:read`
- `notes:write`
- `notes:delete`
- `metadata:read`
- `metadata:write`
- `network`
- `storage`
- `secrets`
- `editor:read`
- `editor:write`
- `ui:commands`
- `ui:notices`
- `ui:panels`

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

## 笔记 API

```ts
context.notes.query({ text, notebookId, tags, sort, limit, offset });
context.notes.get(noteId);
context.notes.create({ notebookId, title, contentMarkdown, tags });
context.notes.update(noteId, { title, contentMarkdown, tags });
context.notes.delete(noteId, { permanent: false });
context.notebooks.list();
context.tags.list();
context.tags.rename("old", "new");
context.tags.delete("unused");
```

所有写入都经过 EdgeEver 的共享 Repository 和业务层，包括离线队列与桌面端适配器。插件不能直接访问具体存储实现。
读取笔记本和标签需要 `metadata:read`，修改标签需要 `metadata:write`。

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

## 编辑器选区 API

`editor:read` 可以读取当前编辑器选区，`editor:write` 可以替换选区或在光标处插入 Markdown：

```ts
const selection = await context.editor.getSelection();
if (selection && !selection.empty) {
  await context.editor.replaceSelection(selection.text.toUpperCase());
}
await context.editor.insertAtCursor("**Inserted by plugin**");
```

没有打开可编辑笔记时，读取返回 `null`，写入会抛出错误。插件修改会进入正常的编辑器事务和自动保存流程。

## 自定义面板

插件可以注册框架无关的 DOM 面板。用户从「插件市场」的已安装插件区域打开面板，关闭、停用或卸载插件时宿主会执行清理函数：

```ts
context.ui.panels.register({
  id: "dashboard",
  title: "Dashboard",
  mount(container) {
    const heading = document.createElement("h2");
    heading.textContent = "Plugin dashboard";
    container.append(heading);
    return () => heading.remove();
  }
});
```

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
