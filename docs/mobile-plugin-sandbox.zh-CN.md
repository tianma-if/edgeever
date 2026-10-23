# 移动端插件沙箱（基础层）

状态：**P1 基础层**，尚未接入 Android / iOS。本文描述原生宿主未来在 WebView 中嵌入的共享运行时。

## 为什么用 WebView 沙箱

插件是 ES module，面板依赖 DOM。React Native（Hermes）无法动态导入/执行下载的模块，也没有 DOM；
SwiftUI 同样无法执行插件 JavaScript。而 Android 与 iOS 客户端已经有成熟的「Web 内容 + 原生桥」方案
（`'use dom'` 组件、WKWebView 编辑器 bundle），因此让插件运行在独立的 WebView 文档里，原生侧只负责
鉴权、存储与原生界面。

## 包结构

`packages/plugin-sandbox` 与具体平台无关，不依赖 React、Expo 或 Swift：

| 模块 | 职责 |
| --- | --- |
| `protocol.ts` | 带版本号的宿主 ↔ 沙箱消息、面板 chrome 序列化、平台过滤。 |
| `bridge.ts` | 请求/响应关联、超时、宿主发起的查询、通知与错误映射。 |
| `context.ts` | 基于 bridge 构造 `@edgeever/plugin-api` 的 `PluginContext`；暂不支持的能力抛出 `SandboxUnsupportedError`。 |
| `panel.ts` | 在沙箱 DOM 中挂载插件面板，转发宿主渲染的 chrome，并把宿主操作分发给插件回调。 |
| `runtime.ts` | 启动流程：等待 `init`、加载并激活插件、转发事件与命令、处理销毁。 |
| `transfer.ts` | 字节、请求头、multipart 表单、`Response`、`Blob` 的 JSON 安全传输。 |

## 消息流程

1. 沙箱 → 宿主：`ready`。
2. 宿主 → 沙箱：`init`，包含 manifest、`platform`（`android`/`ios`）、locale 与设置快照。
3. 沙箱加载插件入口并调用 `activate(context)`，随后发送 `activated`（注册的命令/面板摘要）。
4. 运行期消息：
   - 沙箱 → 宿主 `request`（`notes.*`、`network.fetch`、`storage.*`、`settings.*`、`panel.open` 等），
     宿主回 `response`。
   - 宿主 → 沙箱 `request`（目前为 `panel.beforeClose`），沙箱回 `query-result`。
   - 宿主 → 沙箱通知：`event`、`settings.changed`、`command.run`、`panel.*`。
   - 沙箱 → 宿主通知：`notice`、`panel.chrome`、`panel.close-request`、`error`。

线上传输为 JSON，二进制使用 base64（见 `transfer.ts`）。双方都必须拒绝 `v` 与
`PLUGIN_SANDBOX_PROTOCOL_VERSION` 不一致的消息。

## 本基础层支持的能力

已支持（走 bridge）：`notes`（query/get/create/update/delete/move/pin/restore/editMarkdown 与修订）、
`notebooks`、`tags`、`templates`（list/create/update/delete/use）、`resources.list`、
`resources.read`、`storage`、`secrets`、`settings`、`network.fetch`（direct；请求体支持文本与
`FormData` 上传）、`ui.showNotice`、`ui.openNote`、`ui.panels`、`events`、`commands`。

暂不支持（以可读错误拒绝，便于插件自行降级）：`editor`、`ai`、`schedules`、图表/表格/海报/信息图、
资源写入类 API、embed 渲染。

## 原生宿主职责

- 同步工作区插件目录，通过实例分发接口下载插件包，校验大小/哈希并缓存。
- 令牌不下发到沙箱，所有 bridge 请求由原生侧完成。
- 按插件命名空间持久化设置、storage 与 secrets（secrets 用 Keychain/Keystore）。
- 原生渲染面板 chrome（标题操作、搜索、标签页、空状态、关闭确认）。
- 沙箱 WebView 只加载下载的插件 bundle，禁止外部导航。

## 测试

`bun test packages/plugin-sandbox` 使用假 transport 覆盖 bridge、context 映射、面板生命周期与
运行时启动，因此不依赖真机即可在 CI 验证协议契约；原生接入在各平台的后续改动中用真机验证。
