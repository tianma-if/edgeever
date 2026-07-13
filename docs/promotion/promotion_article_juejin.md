# 💡 掘金推广文章推荐标题（三选一）

1. **🔥 0 元自建！我用 Cloudflare 免费额度做了一个“印象笔记”替代品，原生支持 AI 自动整理！**
2. **别交服务器月租了！用 Cloudflare Serverless 架构，0 成本白嫖终身免费的个人知识库**
3. **这才是 AI 时代的开源笔记！经典三栏布局 + 零服务器托管，让 Claude 帮你打理知识库**

## 📝 掘金文章编辑摘要（三选一，限100字内）

* **第 1 版（最推荐，突出无服务器与AI）**：
  > 0元免服务器！用Cloudflare免费级配额自部署开源三栏笔记EdgeEver，无VPS月租与运维心智负担。原生支持AI Agent (MCP)，让Claude/GPT帮你管理知识库，体验终身免费的个人大脑！
* **第 2 版（侧重开发者极客风）**：
  > 为AI时代打造的开源笔记EdgeEver！保留经典三栏体验，基于Cloudflare Serverless架构实现日常零费用自托管。内置MCP，AI助手可原生读取整理笔记，0成本构建个人专属的智能知识库。
* **第 3 版（侧重产品替代/告别限制）**：
  > 告别收费限制与高昂自建成本！开源笔记EdgeEver完美保留经典印象笔记三栏体验，跑在Cloudflare免费额度上，终身无需服务器与运维。支持AI Agent原生连接，助你搭建免费的第二大脑。

---

# 正文内容

## 引言：当你的个人知识库被“绑架”

作为一名重度笔记用户，不知道你是否也经历过这些痛点：

* **传统笔记软件越来越臃肿**：某象笔记开机卡顿、广告漫天，甚至开始限制多设备登录；
* **自建笔记成本高昂**：想用 Docker 自建个 Memos 或 Wiki，每个月还得给云服务器（VPS）交 **3~5美刀** 的服务器月租，还要配置证书、防 DDOS、维护容器，心智负担拉满；
* **数据封闭，难以迁移**：笔记被锁死在特定格式里，想导出来比登天还难；
* **对 AI 极度不友好**：不支持 MCP，AI 助手（如 Claude Code, Cursor 等）根本无法读取和整理你的本地笔记。

如果你也深受折磨，那么是时候了解一下 **EdgeEver** 了。

---

## 🚀 什么是 EdgeEver？

**EdgeEver** 是一个**开源、自托管、Cloudflare-native（无服务器架构）**的现代笔记工作区。它不仅完美保留了经典印象笔记的“三栏体验”，更是一款真正**为 AI 时代设计的个人知识库**。

最重要的是：**它自部署不需要你购买任何服务器，日常使用完全免费！**

* **GitHub 仓库**：[tianma-if/edgeever](https://github.com/tianma-if/edgeever)
* **在线 Demo**：[https://demo.edgeever.org](https://demo.edgeever.org)

---

## 💎 核心亮点：为什么它与众不同？

### 1. 终身免服务器，100% 免费（白嫖 Cloudflare 边缘计算红利）

传统的自部署项目离不开 VPS 虚拟主机，而 EdgeEver 另辟蹊径，采用了纯 **Serverless（无服务器）** 架构。

它完全运行在 **Cloudflare Workers + D1 (SQLite) + R2 (对象存储)** 上：
* **不需要购买任何云服务器**，省去每月的租金；
* **不需要折腾复杂的 Docker、Nginx 或 SSL 证书**，Cloudflare 帮你搞定一切；
* **白嫖 Cloudflare 的免费配额**：
  * **D1 数据库**：每天读写额度极高，足够存放 **15 万条** 短笔记；
  * **R2 对象存储**：提供 10GB 免费存储空间，按图片平均 200KB 算，可存放 **5 万张** 笔记配图。
  
> 💡 *提示*：EdgeEver 还内置了前端图片本地压缩机制，截图上传前自动转为 WebP 并限制分辨率，体积减少 50%~90%，进一步榨干免费额度！

### 2. 完美复刻“三栏式”工作流

很多轻量化笔记产品为了简洁砍掉了经典的布局。而 EdgeEver 坚持保留了最符合人类知识整理直觉的**三栏设计**：

* **左栏**：无限级嵌套的笔记本树，支持鼠标拖拽排序与层级调整；
* **中栏**：笔记列表，支持多选批量移动、批量合并；
* **右栏**：富文本编辑区，基于 TipTap 深度定制，支持 Markdown 快捷输入，并原生支持**查看历史版本**，随时可以回溯。
* **多端适配**：完美适配 PC 与移动端，支持安装为 **PWA** 应用，像原生 App 一样启动。

### 3. AI Agent 原生连接器（Remote MCP）

这不仅是一个人写的笔记，更是你和 AI 助手协同的“大脑”。

EdgeEver 内置了 **REST API**、**OpenAPI 协议** 以及 **Remote MCP (Model Context Protocol) Endpoint**：
1. 在 EdgeEver 个人中心生成一个 MCP Token；
2. 填入你的 AI 助手（如 Codex、Claude Code、Antigravity、Cursor 等）；
3. **授权 AI 直接读取、整理和维护你的笔记库**。

**💡 玩法放飞脑洞：**
* 吩咐 Claude Code：“帮我把最近随手记下的散乱想法归纳成一篇技术博客大纲”；
* 让 AI 分析你过去几个月的学习笔记，精细化构建你的知识图谱；
* 批量为没有分类的笔记自动打上标签。

---

## 🛠 部署指南：如何一键“白嫖”？

EdgeEver 的部署简单到了极致，甚至你都不需要打开终端。

### 方式 A：AI Agent 一句话部署（推荐）

将下面这段话，复制给你的 AI 助手（如 Claude Code, Cursor, Antigravity 等）：

```text
请按以下流程操作：
1. Fork EdgeEver 上游仓库：https://github.com/tianma-if/edgeever
2. 使用 Fork 后的仓库，将 EdgeEver 安装并部署到 Cloudflare。
3. 为 Fork 仓库配置从上游仓库同步更新的机制，使其能够定期或按需获取上游仓库的最新代码与产品特性。
```

AI 助手将自动帮你在 Cloudflare 上建好 D1、R2，配置好 Worker 路由并一键发布上线。

### 方式 B：手动部署（10 秒搞定）

如果你喜欢自己动手，只需在本地拉下代码，运行几条简单的辅助命令：

```sh
# 1. 复制环境变量
cp .env.local.example .env.local

# 2. 安装依赖并自动初始化资源
bun install
EDGE_EVER_PASSWORD='你的后台登录密码' bun run deploy:setup

# 3. 环境自检并部署
bun run deploy:doctor
bun run deploy
```

部署完成后，终端会直接输出你的独立访问域名，点开即可使用！

---

## ⚖️ 自建方案大比拼

| 特性 | 传统自建笔记 (如 Docker 部署) | 商业云笔记 (如 Notion / 某象) | **EdgeEver 自托管** |
| :--- | :--- | :--- | :--- |
| **服务器成本** | 💰 需购买 VPS (3~5美刀/月) | 🆓 免费但受限 / 需高额订阅 | **🎉 0 元 (跑在 Cloudflare 免费额度)** |
| **运维难度** | 🛠 需维护 Docker/网络/SSL/安全漏洞 | 0 运维 | **0 运维 (Cloudflare 全托管托管)** |
| **数据隐私** | 🔒 极高 (存在自己服务器) | ⚠️ 存在第三方云端，有倒闭/扫描风险 | **🔒 极高 (存在自己的 Cloudflare 账号中)** |
| **AI 协同** | ❌ 很难对接 AI 客户端 | ⚠️ 需购买官方高昂的 AI 增值服务 | **✅ 原生 Remote MCP，免费对接各类 Agent** |

---

## 💬 结语

EdgeEver 的诞生，是为了让每个开发者都能低门槛、无成本地拥有一个真正属于自己的、安全的、且面向 AI 时代的知识库。

如果你觉得这个项目对你有帮助，欢迎来 GitHub 点个 **Star** 支持一下！

* **GitHub 仓库**：👉 [tianma-if/edgeever](https://github.com/tianma-if/edgeever)
* **Demo 试用**：👉 [demo.edgeever.org](https://demo.edgeever.org)
