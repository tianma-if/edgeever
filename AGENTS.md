# AGENTS.md

本文件用于约束和指导参与本项目的 AI 代理与协作者。

## 文档与分支约束

- **技术栈与背景**：优先参考 `README.md`。
- **移动端平台边界**：Android 客户端位于 `apps/mobile`，使用 Expo / React Native 实现；iOS 客户端位于 `apps/ios`，使用 Swift / SwiftUI 原生实现。
- **双语同步**：修改中文文档时必须同步更新对应的英文文档。
- **分支规范**：严禁创建新分支，所有修改与提交必须直接在 `main` 分支上完成。

## GitHub Actions 与 Release 约束及流程

1. **Fork 工作流边界**：配置 GitHub Actions 时必须考虑大量用户会 Fork 仓库进行自部署；仅官方仓库需要的 Job 必须使用 `github.repository == 'tianma-if/edgeever'` 门禁，严禁在下游 Fork 中分配 Runner 或执行。
2. **版本号与基线**：`vX.Y.Z`（非 Draft/Prerelease）。发布须显式 `--bump patch|minor|major`（脚本不自动选级）；按 SemVer 选择，**禁止因发版节奏把用户可感知的新能力或新平台压成 patch**。递增根目录 `package.json`；含移动端修改时同步 `apps/mobile/app.json` 的 `expo.version` 并递增 `android.versionCode`。上一个正式 Release 为审计基线。
3. **跨平台 Release 资产**：每个正式 Release 页面必须同时包含 macOS arm64 DMG、macOS x64 DMG 和 Android arm64 APK。若本次未修改对应原生运行时代码、依赖、配置或构建工具，直接复用上一个正式 Release 中已验证的原始资产，保留原文件名与校验和，禁止仅为匹配新版本号而重命名。
4. **验证命令**：必须通过 `bun run typecheck`、`bun run typecheck:mobile` 和 `bun run build:web`。
5. **测试职责边界**：正式 Release 必须先在官方仓库及与下游一致的 Ubuntu 环境通过完整非 E2E 测试，严禁将上游自身的测试失败转嫁给下游 Fork 发现。只读部署 Fork 仅同步产品快照且不运行测试；只有显式保留定制改动的 Fork 才验证合并结果，失败时必须保持 `main` 与生产环境不变。
6. **原生资产构建与复用**：由 `scripts/plan-native-release.mjs` 决定重建或复用；桌面资产包含 `apps/web`。修改判定规则时同步更新测试。移动端重建使用 `bun run build:android:apk:local`，签名配置保存在仓库外。
7. **Draft 内准备资产**：通过带 `release_tag` 的 `workflow_dispatch` 在 Draft 中准备并验证资产；`published` 事件只审计，禁止重新构建或上传。
8. **桌面验证职责**：桌面 Release 工作流负责测试、包结构检查、签名与公证；代理不再重复下载 Draft 或执行本地首次启动验收，除非用户明确要求。
9. **发布后更新**：正式发布后，发布流程默认不得下载、覆盖安装或启动 `/Applications/EdgeEver.app`；已安装的桌面端通过应用内自动更新机制获取新版。仅在用户明确要求时使用 `--install-desktop` 执行原有安装验收，功能体验由用户在实际使用中验证。
10. **失败处理**：工作流或资产审计失败时保持或恢复 Draft，修复后重跑；不得公开已知损坏的 Release。
11. **Release 说明结构**：使用中英文双语格式（正文禁止包含字面量 `\n`），只写用户可感知的变化、影响以及必要的升级或迁移提醒。类型检查、构建命令、签名、公证、资产复用等技术验证细节保留在 Actions 和关联 Issue 中，不写入公开 Release 正文。功能/修复关联对应 Issue 并标记 Label，发布后回链并关闭 Issue。正文结构：

```md
## 🇨🇳 中文说明 / Chinese Changelog

## 主要更新

- 面向用户说明本次变化及影响。

关联 Issue：#<issue-number>

## Key Changes

- User-facing summary of changes in English.

Related Issue: #<issue-number>
```

## 环境、部署与组件约束

- **Cloudflare 部署**：严格按 `docs/agent-deploy-cloudflare.md` 执行。
- **跨运行时架构**：项目未来将正式支持 Docker 自托管；实现新功能时必须保持业务逻辑与 Cloudflare 解耦，并为其他运行时预留扩展边界。Cloudflare 与 Docker 必须共用同一套业务代码，仅允许保留薄且稳定、不包含业务判断的运行入口和基础设施驱动适配器。
- **数据库 Migration**：数据库或种子变化时，在 `migrations/` 下新增递增编号 SQL，禁止修改已执行的旧 Migration。
- **本地启动**：默认 `bun run dev`（纯本地环境）；指定远程实例用 `EDGE_EVER_INSTANCE=<实例名> bun run dev:remote`；纯前端用 `bun run dev:web`。
- **Demo 示例同步**：修改示例笔记后，在 `main` 分支干净状态下执行 `bun run demo:sync` 重置公开 Demo。
- **禁止重复造轮子**：严禁重复实现已有成熟方案；优先采用维护活跃、广泛验证的开源组件与依赖，并优先复用 `shadcn/ui`；复杂或重复模块封装为独立组件。
- UI和交互的原则是，产品始终表现得可靠、可预测、确定、被接住。
- **悬停提示**：所有悬停或聚焦提示严禁使用 HTML 原生 `title`；Web 端必须统一使用 shadcn/ui 的 Tooltip 组件，并确保键盘聚焦时同样可见。

## 品牌视觉规范 / Brand Identity

- **品牌色**：主绿色 `#16A06E`，Logo 图形色 `#07130B`。
- 修改 Logo 后执行 `bun run prepare:brand:icons` 同步各平台资源。
