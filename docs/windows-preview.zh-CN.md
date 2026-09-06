# Windows x64 预览版

## 分发状态

EdgeEver 通过官方 [GitHub Releases](https://github.com/tianma-if/edgeever/releases/latest)
页面分发 Windows x64 预览版。当前安装包与应用内可执行文件尚未使用
Authenticode 签名，因此 Windows SmartScreen、杀毒软件或组织策略可能提示风险或
直接阻止安装。这类提示是预览阶段的预期现象，但并不表示任意来源的副本都安全。

- 仅从 `tianma-if/edgeever` 官方 Release 下载。
- 不要为 EdgeEver 关闭 SmartScreen、杀毒软件或组织安全控制。
- 如果组织策略阻止安装，请先使用 Web/PWA 客户端，等待后续
  Authenticode 签名版本。

## 自动更新

安装包未签名并不会阻止 NSIS 更新器下载和安装后续 Release。EdgeEver 增加了独立
信任门禁，避免更新通道只依赖同样未签名的 `latest.yml`：

1. 客户端读取 `latest.yml` 发现新版本，但此时不会开始 Windows 下载。
2. 客户端从该版本的官方 Release 获取 `latest-windows.json` 与
   `latest-windows.json.sig`。
3. 客户端使用安装包内固定的公钥验证 Ed25519 签名，并要求版本、文件名、大小与
   SHA-512 和 `latest.yml` 完全一致。
4. 客户端自动下载安装包，再用已签名清单核验其大小、SHA-512 与 SHA-256。
5. 只有通过本地文件复核的安装包，才能在用户确认重启时安装，或在用户退出
   EdgeEver 时自动安装。

清单缺失、密钥未知、签名无效、版本不一致或安装包被修改时，更新一律停止。
Windows 安装包未通过最终本地校验前，应用不会开启退出时自动安装。

该机制保护更新决策和安装包字节，但不会消除首次安装时的 Windows 信誉提示、
不会在资源管理器中提供发布者身份，也无法绕过组织的应用控制策略；这些能力仍需
可信 Authenticode 签名。

## Release 资产与离线签名

每个正式 Release 包含以下 Windows 资产：

- `EdgeEver-<version>-windows-x64.exe`
- `latest.yml`
- `latest-windows.json`
- `latest-windows.json.sig`
- `SHA256SUMS-windows.txt`

GitHub Actions 构建并验证未签名安装包，随后把除签名文件以外的四项输入上传到
Draft Release。发布命令使用 `EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY` 指向的
仓库外密钥，在本机为精确清单离线签名；然后触发独立 GitHub Actions 审计，重新
下载全部五项资产并验证签名及安装包摘要，全部通过后才允许公开发布。

私钥必须是 Ed25519 PKCS#8 PEM 文件，必须保存在仓库外，并在另一个安全位置留有
备份。发布 shell 使用绝对路径配置：

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

首个信任锚的密钥 ID 为 `edgeever-windows-update-2026-01`，SPKI DER SHA-256
指纹为 `ec12b4b5673a2e6ac3666d0cc90dd5c418f3650418cd2b91fa09cec969d50db9`。

私钥缺失或与桌面客户端固定的公钥不匹配时，Release 会保持 Draft。密钥轮换必须
跨两个 Release：先发布同时信任新旧公钥、但仍由旧密钥签名的客户端；后续 Release
再切换到新密钥签名。

## 未来迁移到 Authenticode

获得可信证书后：

1. 签署所有随包发布的 PE，包括 `EdgeEver.exe`、Rust sidecar、辅助可执行文件和
   最终 NSIS 安装包。
2. 把证书精确主题配置为 electron-builder 的 `publisherName`，让已签名客户端
   强制校验发布者连续性。
3. 必须在全部 Authenticode 签名完成后再生成 `latest.yml`、EdgeEver 签名清单与
   校验和，因为签名会改变文件字节。
4. 迁移期间及迁移后继续保留独立 Ed25519 门禁。现有未签名预览版没有声明
   Authenticode 发布者，因此可以接收首个已签名安装包；新签名客户端随后会对后续
   更新增加发布者校验。

首次公开 Windows 平台属于用户可感知的新平台，必须按 SemVer 使用 minor 递增，
不能作为 patch 发布。
