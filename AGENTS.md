# AGENTS.md

本文件用于约束和指导参与本项目的 AI 代理与协作者。

## 文档与分支约束

- **技术栈与背景**：优先参考 `README.md`。
- **双语同步**：修改中文文档时必须同步更新对应的英文文档。
- **分支规范**：严禁创建新分支，所有修改与提交必须直接在 `main` 分支上完成。

## GitHub Release 约束与流程

1. **版本号与基线**：使用 `vX.Y.Z` 格式（非 Draft/Prerelease）。递增根目录 `package.json`；若含移动端修改，同步更新 `apps/mobile/app.json` 的 `expo.version` 并递增 `android.versionCode`。上一个实际 Release 为审计基线。
2. **验证命令**：必须通过 `bun run typecheck`、`bun run typecheck:mobile` 和 `bun run build:web`。
3. **APK 构建与签名**：仅当变更影响移动端运行时代码、共享依赖、原生配置或构建工具时，执行 `bun run build:android:apk:local` 构建生产签名 APK，命名为 `edgeever-android-vX.Y.Z-arm64-v8a.apk`（签名配置必须位于仓库外 `~/.config/edgeever/android/signing.env`）。无移动端变更时复用最近兼容 APK。
4. **Release 说明结构**：使用中英文双语格式（正文禁止包含字面量 `\n`）。功能/修复关联对应 Issue 并标记 Label，发布后回链并关闭 Issue。正文结构：

```md
## Key Changes

- User-facing summary of changes in English.

Related Issue: #<issue-number>

## Verification

- List completed tests, type checks, and build results in English.

<details>
<summary><b>🇨🇳 点击展开中文说明 / Chinese Changelog</b></summary>

<br/>

## 主要更新

- 面向用户说明本次变化及影响。

关联 Issue：#<issue-number>

## 验证

- 列出实际完成的测试、类型检查和构建结果。

</details>
```

## 环境、部署与组件约束

- **Cloudflare 部署**：严格按 `docs/agent-deploy-cloudflare.md` 执行。
- **数据库 Migration**：数据库或种子变化时，在 `migrations/` 下新增递增编号 SQL，禁止修改已执行的旧 Migration。
- **本地启动**：默认 `bun run dev`（纯本地环境）；指定远程实例用 `EDGE_EVER_INSTANCE=<实例名> bun run dev:remote`；纯前端用 `bun run dev:web`。
- **Demo 示例同步**：修改示例笔记后，在 `main` 分支干净状态下执行 `bun run demo:sync` 重置公开 Demo。
- **组件复用**：优先复用 `shadcn/ui` 与已成熟依赖，禁止无意义造轮子；复杂或重复模块封装为独立组件。
