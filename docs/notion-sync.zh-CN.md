# Notion 双向同步

EdgeEver 内置与 Notion 数据库（Database）的实时双向同步能力，在 Cloudflare Workers 与自托管（Docker / Bun）运行时下共享同一套实现，无需部署额外的外部中转服务。

## 功能概览

- **同步范围**：双向同步笔记标题、Markdown 正文、标签（`Tags`）、所属笔记本（`Notebook`）与置顶状态（`Pinned`），删除笔记时自动在另一侧归档或移入回收站。
- **自动建列**：连接 Notion 数据库后自动识别现有的标题列（无论名称为 `Name`、`标题` 或其他自定义列名），并自动补齐 `Tags`（多选）、`Notebook`（单选）、`Pinned`（复选框）和 `EdgeEver ID`（富文本）四个属性列。
- **防回环与幂等保护**：
  - EdgeEver 侧仅对非同步代理（`actorId !== "notion-sync"`）提交的笔记变更触发后台推送；
  - Notion Webhook 侧自动忽略全部由机器人（`type === "bot"`）触发的事件，并校验 `X-Notion-Signature` HMAC-SHA256 签名与投递 ID 去重；
  - 双方统一比对规范化内容 SHA-256 摘要，内容未变化时不产生重复写入。
- **结构化笔记保护**：海报、结构化表格、流程图与信息图笔记仅向 Notion 输出可读预览文本与属性，反向更新时仅同步标题、标签、笔记本与置顶状态，避免破坏原始结构化数据。

## 配置步骤

1. **创建 Notion 内部集成并授权数据库**
   - 打开 [Notion Integrations](https://www.notion.so/profile/integrations)，新建一个 Internal Integration（勾选读取、更新、插入内容权限），复制 `ntn_...` 密钥。
   - 在 Notion 中新建或打开目标数据库页面，点击右上角 `•••` → **更多** → **集成（Connections）**，关联刚创建的集成。
   - 复制该数据库的链接或 32 位数据库 ID。

2. **在 EdgeEver 保存同步设置**
   - 以实例所有者身份进入 **设置 → 数据 → Notion 双向同步 → 配置同步**。
   - 填入 Notion 内部集成密钥与数据库链接（或 32 位 ID），可先点击 **测试连接** 确认连通，再点击 **保存配置**。
   - 保存后弹窗会生成当前工作区专属的 **Notion Webhook 回调地址**（`/api/public/webhooks/notion/<token>`）。

3. **激活 Notion Webhook 实时回写**
   - 在浏览器打开 [Notion Integrations](https://www.notion.so/profile/integrations) → 选择你的集成 → **Webhooks** 标签页 → 创建订阅。
   - 填入上一步复制的回调地址，勾选 Page 相关事件（`page.created`、`page.content_updated`、`page.properties_updated`、`page.deleted`、`page.undeleted`、`page.moved`）并发送验证请求。
   - EdgeEver 配置弹窗会自动显示收到的 `secret_...` 验证令牌，点击复制并粘贴回 Notion 验证弹窗即可激活；首次签名事件到达后，EdgeEver 会自动将该验证令牌提升并加密保存为正式签名密钥。

4. **存量笔记初始化（可选）**
   - 点击 **立即全量同步**，客户端会按游标分批完成存量笔记的双向对齐，不执行全表重复扫描。
