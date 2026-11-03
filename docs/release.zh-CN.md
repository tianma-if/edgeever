# Release 发布指南

## 执行发布

在 macOS 上从与 `origin/main` 一致且工作区干净的 `main` 分支执行：

任何需要重建桌面资产的 Release，都应先让发布 shell 指向仓库外保存的 Windows
更新清单 Ed25519 私钥：

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

```bash
bun run release -- \
  --bump patch \
  --issue-title "Improve the release workflow" \
  --label enhancement \
  --change-en "Run required release checks in parallel." \
  --change-zh "并行执行发布所需检查。" \
  --change-locale "ja:必要なリリースチェックを並列実行します。" \
  --change-commit "abcdef1" \
  --change-issue "123:en"
```

多项变化需要按组重复传入 `--change-en`、`--change-zh`、
`--change-locale ja:`、`--change-commit` 和 `--change-issue`。App Store 列表含日文，因此必须提供
日文 What’s New。一项变化可以关联多个以逗号分隔的提交：

```bash
--change-commit "abcdef1,1234567"
```

上一个正式 Release 之后的每个提交都必须被覆盖。不面向用户的提交需要填写
具体原因后显式排除：

```bash
--ignore-commit "89abcde:仅增加测试覆盖"
```

覆盖审计在修改本地或 GitHub 状态之前执行，映射记录在跟踪 Issue 中。
使用 `--dry-run` 预览提交覆盖、原生端重建计划和 Release 说明。

### 已解决 Issue 的自动收尾

每条变化必须同时传入 `--change-issue "123:en,456:zh"`，声明本次已完整解决的
同仓库 Issue 及回复语言；英文讨论使用 `en`，中文使用 `zh`，中英混合默认 `en`。
没有已解决 Issue 时必须显式传入 `--change-issue none`。PR 编号不能用作关闭目标；
仅相关或部分实现的 Issue 不应列入。脚本不会从任意 `#编号` 推断关闭目标。

`--dry-run` 会核查并显示目标。映射保存在跟踪 Issue 和发布检查点中，Release
说明自动关联这些 Issue；续跑 Draft 必须使用相同的声明。发布后的桌面、Android
和 GHCR 阻塞审计全部通过后，脚本先按声明语言回链 Release，再关闭仍处于打开
状态的目标 Issue。已关闭的 Issue 只补回链，保留原关闭原因。iOS 商店交付、Demo
及 TCR 等非阻塞任务不影响此收尾条件。

回链失败时不会关闭对应 Issue；其他目标仍会继续处理。部分失败会保留正式
Release 和未关闭的跟踪 Issue，并输出独立续跑命令：

```bash
bun run release -- --finish-issues vX.Y.Z
```

该命令从已保存的计划和成功审计记录恢复，仅处理 Issue，不重新发布或构建资产。
重复执行不会重复回链；缺少计划、成功审计记录、目标提交不一致或 Release 已恢复
Draft 时拒绝关闭。可加 `--dry-run` 只查看计划。旧发布没有这些记录时不能使用此入口。

### 外部贡献者署名

- 维护者本人完成的内容无需署名；外部贡献在对应条目末尾注明 `@username` 和 PR。
- 同一人贡献多项时可改为集中致谢。结尾名单仅列出未逐条致谢的人，名单为空则省略。
- GitHub 原生 Contributors 头像区由正文中的 `@username` 自动生成，逐条提及同样有效。

逐条署名写入 `--change-zh` / `--change-en`；集中名单使用可重复的
`--contributor alice`，脚本会在双语说明末尾追加
`贡献者 / Contributors：@alice`。该参数不自动推断贡献者。
续跑已有 Draft 时保留原说明，调整署名需直接编辑 Draft。

## EdgeEver 特有规则

- 正式 Tag 和 Release 标题使用 `vX.Y.Z`。`--bump` 须显式指定，按 SemVer 选择；
  禁止因发版节奏把用户可感知的新能力或新平台压成 patch（详见 `AGENTS.md`）。
- 根版本表示整体产品 Release。只有对应原生运行时重建时，才更新原生展示版本。
  Android `versionCode` 和 iOS Build Number 是相互独立且严格递增的标识。
- 每个正式 Release 包含 macOS arm64 与 x64 DMG、按架构区分的更新 ZIP、带独立
  签名更新清单的未签名 Windows x64 预览版安装包、带更新元数据与 SHA-256 清单的 Linux x64
  AppImage 预览版，以及 Android arm64 APK。
  未变化的原生资产沿用原文件名、版本和校验和。
- 桌面端和 Android 更新检查使用对应 Release 资产中记录的版本，而不是整体
  GitHub Tag，避免仅涉及 Web 或 API 的 Release 触发无效原生更新。
- 脚本负责创建跟踪 Issue 和 Draft Release、验证或复用原生资产、准备并审计
  GHCR 多架构 Docker 镜像、正式发布、关闭 Issue，
  默认不安装桌面端应用；安装验收需显式传入 `--install-desktop`。
  输出 Actions 链接后，Demo 部署会独立继续执行。
- 独立工作流会把同一个已验证 Git 提交发送到 CNB；正式 Release 发布后，CNB
  在腾讯云侧异步构建并审计 TCR 公共镜像。其耗时或失败不会阻塞 GitHub
  Release，也不会把已发布版本恢复为 Draft。
- Draft 原生资产准备完成后，发布命令会强制核验 Android APK 是否使用
  Google Play 应用签名证书；未通过时保持 Draft 并停止。此时先针对同一 Draft
  执行
  `bun run publish:stores -- --release vX.Y.Z --platform android --android-track production`，
  再重新执行原发布命令续跑。当审计范围内包含 iOS 运行时变化时，同一条命令
  会在 GitHub 公开发布之后启动 Xcode Cloud 并提交 App Review。发布后审计
  通过后，脚本会关闭跟踪 Issue，然后再等待 App Store 投递。iOS 失败时，
  GitHub Release 保持已发布，跟踪 Issue 保持已关闭；用
  `bun run publish:stores -- --release vX.Y.Z --platform ios` 重试即可。详见
  [移动端商店交付](store-delivery.zh-CN.md)。
- 网页剪藏插件的商店提交是官方仓库里的独立工作流。提高
  `apps/extension/package.json` 的版本后，运行 **Submit Web Clipper**。
  它不属于 `bun run release`，审核结果也不会改变 GitHub Release。详见
  [网页剪藏插件商店提交](extension-store.zh-CN.md)。
- 公开发布后的桌面和 Android 审计通过 Release API URL 读取文件名并下载安装包。
  Draft 刚公开时，`gh release view --json assets` 和 `gh release download`
  可能持续看不到这些文件；如果把空列表当成资产缺失，发布会被退回 Draft。
- 重建后的桌面资产上传到 Draft 后，本地发布命令只签署
  `latest-windows.json`，私钥不会进入 GitHub Actions。第二次桌面工作流会重新
  下载 Windows 安装包、`latest.yml`、清单、签名和校验和文件并独立审计，通过后
  才能公开发布。详见 [Windows 预览版安全与更新说明](windows-preview.zh-CN.md)。

## 镜像仓库凭据

GitHub 官方仓库必须配置 `CNB_TCR_BUILD_PUSH_TOKEN` Actions Secret，该令牌仅
拥有 CNB 源码镜像仓库的写权限。CNB 私有密钥仓库向可信的 `push` 和
`tag_push` 流水线提供 `TCR_USERNAME` 与 `TCR_PASSWORD`。对于 TCR 个人版，
用户名是腾讯云账号 ID，密码是在 TCR 控制台初始化的固定登录密码。GHCR 是正式
发布的阻塞门禁；CNB 根据同一个 Git 提交异步构建 TCR，写入相同的公共标签，
并独立核验匿名访问和双架构。两边独立构建，不要求 Registry Digest 相同。

## 失败与续跑

- 本地验证、Windows 签名/审计、Draft 资产或 GHCR 镜像失败时，Release 保持
  未发布状态。
- CNB/TCR 异步构建失败时保留正式 Release，并独立修复、重跑。
- 中断后重新执行相同命令，会续跑匹配的 Draft，不会重复创建 Issue、提交或
  Release。
- 发布后的原生资产或 GHCR 镜像审计失败时，脚本会尝试将 Release 恢复为
  Draft，并保留 Issue。
- 这些审计通过后，脚本会先关闭跟踪 Issue，再等待 App Store 投递。之后的
  App Store 失败会让该 Issue 维持关闭。
- 显式安装时若替换应用失败，脚本会尽可能从 macOS 废纸篓备份恢复上一版应用。
