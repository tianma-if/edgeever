# Release 发布指南

## 执行发布

在 macOS 上从与 `origin/main` 一致且工作区干净的 `main` 分支执行：

```bash
bun run release -- \
  --bump patch \
  --issue-title "Improve the release workflow" \
  --label enhancement \
  --change-en "Run required release checks in parallel." \
  --change-zh "并行执行发布所需检查。" \
  --change-commit "abcdef1"
```

多项变化需要按组重复传入 `--change-en`、`--change-zh` 和
`--change-commit`。一项变化可以关联多个以逗号分隔的提交：

```bash
--change-commit "abcdef1,1234567"
```

上一个正式 Release 之后的每个提交都必须被覆盖。不面向用户的提交需要填写
具体原因后显式排除：

```bash
--ignore-commit "89abcde:仅增加测试覆盖"
```

覆盖审计在修改本地或 GitHub 状态之前执行。映射记录在跟踪 Issue 中，不写入
公开 Release 说明。公开说明只包含用户可感知的变化、影响和必要的迁移提醒。

使用 `--dry-run` 查看提交覆盖、原生端重建计划和说明。发布完成后不会下载、
安装或启动 macOS 应用；已安装的桌面端通过应用内自动更新机制获取新版。仅在
确实需要原有安装验收时显式传入 `--install-desktop`。

## EdgeEver 特有规则

- 正式 Tag 和 Release 标题使用 `vX.Y.Z`。`--bump` 须显式指定，按 SemVer 选择；
  禁止因发版节奏把用户可感知的新能力或新平台压成 patch（详见 `AGENTS.md`）。
- 根版本表示整体产品 Release。只有对应原生运行时重建时，才更新原生展示版本。
  Android `versionCode` 和 iOS Build Number 是相互独立且严格递增的标识。
- 每个正式 Release 包含 macOS arm64 与 x64 DMG、按架构区分的更新 ZIP，以及
  Android arm64 APK。未变化的原生资产沿用原文件名、版本和校验和。
- 桌面端和 Android 更新检查使用对应 Release 资产中记录的版本，而不是整体
  GitHub Tag，避免仅涉及 Web 或 API 的 Release 触发无效原生更新。
- 脚本负责创建跟踪 Issue 和 Draft Release、验证或复用原生资产、准备多架构
  Docker 镜像并同时写入 GHCR 与腾讯云 TCR 公共镜像、正式发布、关闭 Issue，
  默认不安装桌面端应用；安装能力作为显式选项保留。
  输出 Actions 链接后，Demo 部署会独立继续执行。
- 此命令不执行移动端商店交付，详见
  [移动端商店交付](store-delivery.zh-CN.md)。

## 镜像仓库凭据

官方仓库必须配置 `TENCENT_TCR_USERNAME` 和 `TENCENT_TCR_PASSWORD` 两个
Actions Secret。对于 TCR 个人版，用户名是腾讯云账号 ID，密码是在 TCR 控制台
初始化的固定登录密码。Draft 准备阶段会向 GHCR 与 TCR 写入相同标签；正式发布
前会以匿名方式检查两个仓库。

## 失败与续跑

- 本地验证、Draft 资产或 Docker 镜像失败时，Release 保持未发布状态。
- 中断后重新执行相同命令，会续跑匹配的 Draft，不会重复创建 Issue、提交或
  Release。
- 发布后的原生资产或 Docker 镜像审计失败时，脚本会尝试将 Release 恢复为
  Draft，并保留 Issue。
- 显式安装时若替换应用失败，脚本会尽可能从 macOS 废纸篓备份恢复上一版应用。
