# AGENTS.md

## 协作表达

- **只写必要信息**：细则、方案、约束及 Issue/PR 回复只写项目特有要求、结论、关键依据与待办，省略 AI 已知的常识、通用最佳实践和重复解释。保留影响决策的风险、例外和未验证项；按需展开。

## 文档约束

- **技术栈与背景**：优先参考 `README.md`。
- **移动端平台边界**：Android 客户端位于 `apps/mobile`，使用 Expo / React Native 实现；iOS 客户端位于 `apps/ios`，使用 Swift / SwiftUI 原生实现。
- **双语同步**：修改中文文档时必须同步更新对应的英文文档。修改根目录 README 时必须同步 `README.md`、`README.zh-CN.md`、`README.zh-TW.md`、`README.es.md`、`README.de.md`、`README.fr.md`、`README.ja.md`、`README.pl-PL.md`、`README.ru.md`。
  - **内部巡检细则例外**：`docs/agent-issue-patrol.zh-CN.md` 和 `docs/agent-pr-review.zh-CN.md` 仅维护中文版，不创建英文副本。

## 变更风险评估

- **面向所有用户修复**：修复必须进入产品代码，对后续版本的所有用户生效；不得只处理维护者本机状态。
- **先评估后实现**：动手前说明功能价值、影响范围、最坏后果、回滚方案和未验证项；低价值但可能扰动成熟链路的需求，默认拒绝或提供低风险替代方案。
- **核心链路从严**：安装器、自动升级、数据存储、认证及迁移的机制或配置变更按高风险处理，须验证真实的旧版到新版链路。未完成对应平台及跨版本验证时须标明风险，不得保证“不影响现有用户/自动升级”。

## Android 调测约束

- **USB 真机优先**：Android 功能调测只用 USB 真机和 `adb`，禁止使用 QEMU、AVD 等模拟器；无可用真机时标明真机验证未完成。

## GitHub 协作

- **回复语言**：Issue、PR 及 Review（含行内意见）遵循对方指定语言，否则使用正文或讨论的主要语言；混合或不明时默认英文，不受本地对话语言影响。
- **PR 评审**：一次性反馈已发现的问题。合并 PR 默认不要求真机验证。已有专项验证要求按对应规则执行。
- **基于 Issue 的提交**：基于 Issue 开发时，提交并推送须关联该 Issue。
- **PR 合并时的 CI 失败归属**：经核实已存在于 `main` 的无关 CI 失败由维护者修复，不得转嫁给 PR 作者或单独阻塞合并；当前 PR 引入的失败由作者修复，合并前须完成相关验证。
- **合并后同步本地**：合并 PR 后，本地若在 `main` 且工作区干净，须 `git fetch` 并快进到 `origin/main`。工作区不干净或不能快进时停止并说明，禁止 reset、rebase 或覆盖改动。代码同步与数据库迁移分开处理。
  - **含迁移的本地 DEV 同步**：`git fetch` 后、快进前，用 `git diff --name-only --diff-filter=A HEAD..origin/main -- migrations/` 检查是否有新增 SQL 迁移。如果有且本仓库的本地 DEV 正在运行，先停止 Web 和 API，再快进本地 `main`。同步后使用 `bun run dev` 重启，由启动流程先应用本地 D1 迁移。确认 `/api/health` 报告预期迁移版本，并通过 Web 端口验证 `/api/v1/auth/session` 正常。启动或迁移失败时，明确报告本地 DEV 尚未恢复。

## GitHub Actions 与 Release 约束及流程

1. **Fork 工作流边界**：仅官方仓库需要的 Actions Job 须使用 `github.repository == 'tianma-if/edgeever'` 门禁，禁止在下游 Fork 分配 Runner 或执行。
2. **版本号与基线**：正式 Release 使用 `v2.Y.Z`（非 Draft/Prerelease），主版本固定为 `2`。须显式选择 `--bump patch` 或 `--bump minor`，禁止 `--bump major`；用户可感知的新能力或新平台须升 minor。递增根目录 `package.json`；含移动端修改时同步 `apps/mobile/app.json` 的 `expo.version` 并递增 `android.versionCode`。上一个正式 Release 为审计基线。
3. **跨平台 Release 资产**：正式 Release 必须包含 macOS arm64 DMG、macOS x64 DMG、Windows x64 Preview 安装包、Linux x64 AppImage Preview 和 Android arm64 APK。Windows Preview 未使用 Authenticode 签名时必须同时提供经仓库外 Ed25519 私钥签名的更新清单；Linux Preview 必须包含 `latest-linux.yml` 更新元数据和独立 SHA-256 清单；两者均须在发布前通过独立下载与摘要审计。对应原生运行时代码、依赖、配置和构建工具均未变时，复用上一正式 Release 已验证的原始资产，保留文件名与校验和，不随版本号重命名。官方正式 Android APK 必须使用固定的 Google Play 应用签名证书；本地上传证书签名的 APK 仅限 Draft 临时使用，须替换为 Play 签名并通过发布门禁后才能公开。
4. **验证命令**：必须通过 `bun run typecheck`、`bun run typecheck:mobile` 和 `bun run build:web`。
5. **测试职责边界**：正式 Release 须先在官方仓库及与下游一致的 Ubuntu 环境通过完整非 E2E 测试。只读部署 Fork 仅同步产品快照、不运行测试；显式保留定制改动的 Fork 须验证合并结果，失败时保持 `main` 与生产环境不变。
6. **原生资产构建与复用**：由 `scripts/plan-native-release.mjs` 决定重建或复用；桌面资产包含 `apps/web`。修改判定规则时同步更新测试。移动端重建使用 `bun run build:android:apk:local`，签名配置保存在仓库外。
7. **Draft 内准备资产**：用带 `release_tag` 的 `workflow_dispatch` 在 Draft 中准备和验证资产；Android 重建须完成 Google Play 交付、替换 Play 签名 APK 并通过独立签名门禁。`published` 只审计，不构建或上传；签名不符时恢复 Draft。
8. **桌面验证职责**：桌面 Release 工作流负责测试、包结构检查、签名与公证；代理不再重复下载 Draft 或执行本地首次启动验收，除非用户明确要求。
9. **发布后更新**：桌面端通过应用内自动更新获取新版；Linux Preview 须在 Draft 阶段通过真实 AppImage 跨版本更新门禁。正式发布后不得下载、覆盖安装或启动 `/Applications/EdgeEver.app`，仅用户明确要求时使用 `--install-desktop` 验收；功能体验由用户验证。
10. **失败处理**：阻塞工作流或资产审计失败时保持或恢复 Draft，修复后重跑。GHCR 镜像为阻塞门禁；腾讯云 TCR 公共镜像在发布后由独立工作流异步同步和审计，不阻塞发布或触发恢复 Draft。
11. **Release 说明结构**：正文使用以下中英双语结构，禁止字面量 `\n`；只写用户可感知的变化、影响和必要升级/迁移提醒，技术验证细节留在 Actions 和关联 Issue。功能/修复关联 Issue 并标记 Label，发布后回链并关闭：

```md
## 主要更新

- 面向用户说明本次变化及影响。

关联 Issue：#<issue-number>

## Key Changes

- User-facing summary of changes in English.

Related Issue: #<issue-number>
```

12. **外部贡献者署名**：维护者本人无需署名；外部贡献逐条注明账号与 PR，或集中致谢。正文名单不重复列名，保留 GitHub 原生 Contributors 头像区。参数用法见 `docs/release.zh-CN.md` / `docs/release.md`。

## 环境、部署与组件约束

- **AI 模型 API 优先客户端直连**：模型请求优先客户端直连；仅 Web 遇浏览器网络或 CORS 限制时可用后端兜底，桌面及原生移动端保持直连。已有 HTTP 响应或开始接收流式结果后，不得自动切换后端重复调用。
- **Cloudflare 部署**：严格按 `docs/agent-deploy-cloudflare.md` 执行。
- **Cloudflare 默认部署入口**：保留 Fork + Workers Builds 及现有上游同步机制；未经明确要求，不改用会改变 Fork 同步方式的 Deploy to Cloudflare 模板入口。
- **跨运行时架构**：Cloudflare 与 Docker 共用业务代码；运行入口和基础设施驱动适配器须保持薄且稳定，不含业务判断，并为其他运行时保留扩展边界。
- **数据库 Migration**：数据库或种子变化时，在 `migrations/` 下新增递增编号 SQL，禁止修改已执行的旧 Migration。
- **数据库读取预算**：备份、分页、同步和轮询必须评估整次操作的累计读取量，禁止逐页或逐次轮询重复全量扫描、计数。使用本地代表性数据验证读取量随页数与数据量的增长，并补充回归测试；不得用生产库全量扫描或压测来验证。额度耗尽必须明确诊断，不得只提示稍后重试。
- **发布与实例恢复**：部署、迁移或额度失败时，须核查相关实例的实际服务端版本和健康状态，明确未部署/未恢复情况；资产通过、客户端升级或额度重置均不代表服务端修复生效。
- **本地启动**：启动/重启 Web 默认用 `bun run dev`，同时启动本地 Web 与 API；仅明确要求纯前端或 `dev:web` 时用 `bun run dev:web`。远程实例用 `EDGE_EVER_INSTANCE=<实例名> bun run dev:remote`。
- **Demo 示例同步**：修改示例笔记后，在 `main` 分支干净状态下执行 `bun run demo:sync` 重置公开 Demo。
- **UI 组件**：优先复用 `shadcn/ui`。
- **交互原则**：可靠、可预测，操作有明确反馈。
- **悬停提示**：禁止 HTML 原生 `title`；Web 统一使用 shadcn/ui Tooltip，键盘聚焦时也须可见。

## 品牌视觉规范 / Brand Identity

- **品牌色**：复用现有的 UI 黑灰配色，Logo 图形色 `#07130B`。
- 修改 Logo 后执行 `bun run prepare:brand:icons` 同步各平台资源。
