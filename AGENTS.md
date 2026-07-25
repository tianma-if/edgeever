# AGENTS.md

本文件用于约束和指导参与本项目的 AI 代理与协作者。除非用户明确给出更高优先级的指令，否则应遵守以下规则。

## 项目背景与技术栈

涉及本项目的背景、定位、部署信息与技术栈说明时，请优先参考 `README.md`。

## 中英文文档同步约束

修改中文文档时，必须同步更新对应的英文文档，确保内容一致。

## Git 分支约束

严禁创建新的 Git 分支；所有修改、提交和推送都必须直接在 `main` 分支上完成。

## GitHub Issue 与 Release 约束

正式版本遵循 Semantic Versioning，标签与 Release 标题统一使用 `vX.Y.Z`。发布前检查远端标签与实际 GitHub Release；孤立标签不作为发布基线，每个正式标签最终都应有对应 Release。

Release 以上一个实际发布的正式 Release 为基线，审计完整提交区间并面向用户汇总所有可感知变化。Release 说明必须使用英文。标签必须指向 `main` 上经过验证的提交，默认发布为非 Draft、非 Prerelease。功能或修复 Release 须关联带对应 Label 的 Issue；发布后回链并关闭 Issue。正文结构：

```md
## 主要更新

- 面向用户说明本次变化及影响。

关联 Issue：#<issue-number>

## 验证

- 列出实际完成的测试、类型检查和构建结果。
```

验证失败时不得发布正式 Release。

每个正式 Release 必须附带可安装的 Android APK。APK 文件名统一使用 `edgeever-android-vX.Y.Z-<ABI>.apk`，例如 `edgeever-android-v0.4.14-arm64-v8a.apk`。GitHub APK 默认仅构建 `arm64-v8a`；只有出现明确兼容需求时才额外提供其他 ABI，Play AAB 仍保留全部架构。若完整变更区间影响移动端代码、其共享依赖、原生配置或 APK 构建，则从本次发布提交重新构建生产签名 APK；否则可复用最近的兼容 APK，并在正文中注明来源 Release。发布前验证 APK 版本、签名、SHA-256 及下载可用性。

### Release 固化流程

执行“提交、推送并发布”时，必须按以下顺序操作：

1. 在 `main` 上检查 `git status --short --branch` 和完整 diff。无关的未提交修改不得混入发布；需要继续保留的工作区修改应使用可恢复的 `git stash` 暂存，发布完成后恢复。
2. 查询远端最新正式 Release 与标签，使用上一个实际 Release 作为变更审计基线；不得以孤立标签或仅存在于本地的标签作为基线。
3. 确定下一个 SemVer 版本。同步更新根目录 `package.json`；若发布包含移动端代码或 APK，则同步更新 `apps/mobile/app.json` 的 `expo.version`，并递增 `android.versionCode`。
4. 为功能或修复关联的 Issue 添加合适 Label（通常为 `enhancement` 或 `bug`），然后提交全部本次发布改动。提交后先推送 `main`，确认远端提交可见。
5. 从即将发布的提交执行验证。至少完成相关类型检查、测试和 Web 构建；移动端变更必须执行 `bun run build:android:apk:local`，不得用工作区其他未提交改动构建 APK。
6. 验证 APK 的 `versionName`、`versionCode`、包名、生产签名、目标 ABI、SHA-256 和文件大小。将产物重命名为 `edgeever-android-vX.Y.Z-arm64-v8a.apk`，并确保只上传该版本产物。
7. 创建标签并推送标签，标签必须指向已验证的 `main` 提交；随后创建非 Draft、非 Prerelease 的 GitHub Release，上传 APK，并在发布后确认 Release、标签、附件状态和下载链接均可用。
8. Release 正文使用英文，必须包含用户可感知的变化、关联 Issue 和实际验证结果；发布完成后将已完成的 Issue 回链到 Release 并关闭。正文必须通过 `--notes-file` 或包含真实换行的字符串提交，禁止把字面量 `\n` 写入 GitHub Release。

推荐的移动端发布验证命令：

```sh
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run build:android:apk:local
```

生产签名环境文件和密钥必须位于仓库外（默认使用 `~/.config/edgeever/android/signing.env`），不得写入仓库、Release 正文或日志。

### Release 加速原则

- 先确定并同步所有版本号，再开始 APK 构建，避免因版本修正重复打包。
- Web/API-only Release 不重复构建 APK；仅当变更影响移动端运行时代码、共享移动依赖、原生配置或构建工具时才重新构建。
- APK 构建优先使用 Expo 增量模式 `bunx expo prebuild --platform android --no-clean --no-install`，保留 Gradle/CMake 缓存并避免自动改写依赖文件；只有原生工程确实需要重建时才清理。
- 依赖未变化时不要在每次 Release 重复安装；Release 脚本应缓存依赖并在 lockfile 变化时才重新安装。
- 推荐将版本同步、验证、APK 判断、构建校验、提交、推送、打标签和创建 Release 串成一个命令，确保 APK 构建完成且验证通过后再推送和发布。

## Cloudflare 自动部署约束

当用户要求根据 GitHub 项目链接将本项目安装部署到 Cloudflare 时，必须先完整阅读并严格按照 `docs/agent-deploy-cloudflare.md` 执行。该文档是此部署流程的唯一操作规范；不要在本文件重复维护部署命令、密码配置或 Workers Builds 步骤。

## 本地启动约束

- 默认使用 `bun run dev` 启动完整本地环境（本地 D1/R2 和固定演示种子），不得连接 `.env.local` 中的远程实例。
- 仅在用户明确指定远程实例并要求连接时，使用 `EDGE_EVER_INSTANCE=<实例名> bun run dev:remote`；私有配置以 `.env.local` 为准，不得硬编码实例名。
- 仅在用户明确要求只启动前端时使用 `bun run dev:web`。

## Demo 示例笔记同步

修改 Demo 示例笔记后，使用 `bun run demo:sync` 将已推送的 `main` 部署到公开 Demo，并用最新种子重置示例数据。该命令独立于正式 Release 流程，不创建版本号、标签、Release 或 APK；执行前必须确保工作区干净且 `main` 与 `origin/main` 一致。命令会删除公开 Demo 中的临时内容。

## 组件复用与造轮子约束

UI 功能应尽量复用 `shadcn/ui` 等现有 UI 组件。在实现其他功能时，也应优先采用成熟、稳定的开源组件或库，绝对禁止在没有充分必要性的前提下自行从零造轮子。

为方便代码维护，当页面或功能模块出现复杂结构、重复布局或潜在复用场景时，应视情况封装为独立组件，保持页面入口聚焦于组合与数据传递。
