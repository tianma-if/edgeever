# 移动端商店交付

GitHub Release 与移动端商店交付是两个独立操作：

- `bun run release` 创建并审计 GitHub Release，但不会自行授权访问 Google Play
  或 App Store Connect。Android 资产只有通过 Play 应用签名门禁后才能正式发布。
- `bun run publish:stores` 针对一个匹配的 Draft 或已经存在的正式 Release tag，
  触发手动商店交付工作流。Android 重建时应在 Draft 阶段执行，以便正式发布前
  用 Play 签名 APK 替换临时的本地签名 APK。
- 触发商店交付就代表已经授权正式提交。默认情况下，Google Play 使用
  Production 轨道；iOS 在上传 App Store Connect 后继续提交 App Review。审核
  通过后自动发布。

## 安全模型

工作流检出不可变的 Release tag，而不是 `main`。开始任何商店构建前都会验证：

- tag 属于匹配的 Draft 或正式、且非 Prerelease 的 GitHub Release；
- Release 目标提交与 Git tag 指向同一个提交；
- 与上一个正式 Release 相比，审计范围内确实包含移动端运行时代码变化；
- 根版本和移动端 App 版本都与 Release tag 一致；
- Android `versionCode` 已递增。

如果某个 Release 复用了上一版移动端二进制，工作流会主动拒绝。它不代表新的
商店二进制，不应重复上传。

正式发布门禁只接受 `ANDROID_PLAY_APP_SIGNER_SHA256`。本地上传证书签名的 APK
可以暂存在 Draft 中供商店处理，但不能成为正式 Release 的最终 Android 资产；
门禁失败时发布命令会停止并保留 Draft。即使绕过发布命令手动公开 Release，
`published` 审计也会拒绝该 APK 并恢复 Draft。

## 前置配置

在 GitHub 仓库中配置以下 Secrets：

- `EXPO_TOKEN`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_PLAY_APP_SIGNER_SHA256`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

将 Google Play 服务账号密钥上传到 Android 应用的 EAS Submit Credentials，
同时将同一份服务账号 JSON 以 base64 保存到上述仓库 Secret，并把 Play Console
中的**应用签名证书**（不是上传证书）SHA-256 指纹保存为
`ANDROID_PLAY_APP_SIGNER_SHA256`。在 EAS 中配置 iOS 分发凭据和 App Store
Connect API Key。凭据和私钥禁止提交到仓库。

创建以下 GitHub Environments：

- `store-delivery`：用于 Android 测试轨道和 Apple App Review 交付。
- `store-production`：用于 Google Play Production 交付。

EAS Submit 要求应用已经在对应商店中创建；Google Play API 提交还要求服务账号
拥有该应用的访问权限。配置方法参考官方
[EAS Android 提交指南](https://docs.expo.dev/submit/android/)和
[EAS Submit 配置参考](https://docs.expo.dev/submit/eas-json/)。

## 命令

同时提交 Google Play Production 和 Apple App Review：

```sh
bun run publish:stores -- --release v1.7.0
```

在正式发布前为 Draft 准备 Android Play 签名资产：

```sh
bun run publish:stores -- \
  --release v1.7.0 \
  --platform android \
  --android-track production
```

只将 Android 交付到封闭测试轨道：

```sh
bun run publish:stores -- \
  --release v1.7.0 \
  --platform android \
  --android-track beta
```

使用 `--dry-run` 可以只输出将要触发的 GitHub 工作流，不实际启动。

## 各平台行为

### Google Play

自托管发布 Runner 会从指定 tag 构建仅含 `arm64-v8a` 的签名 AAB，验证签名和
R8 Mapping，将两者保留为 GitHub Actions Artifacts，然后通过 EAS Submit 上传
AAB。

Google Play 处理完 AAB 后，工作流会下载由 Play 应用签名密钥签名的通用 APK，
核对固定的应用签名证书，并替换 Draft 或正式 GitHub Release 中的 Android 资产。
Draft 中的替换结果还必须通过独立的发布前签名门禁。这样从 Play
和 GitHub 安装的版本可以互相覆盖升级。上传的 AAB 会明确限制为
`arm64-v8a`，因此 Play 生成的通用 APK 不会再打包无用的 32 位 ARM 或 x86
原生库。该 Release 必须关闭 Automatic Protection；当 Play 返回带安装来源限制
的产物时，下载器会直接失败，防止此类 APK 再次发布到 GitHub 供侧载。

Internal、Alpha、Beta 和 Production 配置都会在所选轨道创建 Completed
Release。默认命令直接使用 Production；只有明确要求测试交付时才使用
`--android-track internal`、`alpha` 或 `beta`。

### App Store Connect

原生 iOS 商店二进制来自 **`apps/ios`**（SwiftUI），不再走 Expo EAS。
在 macOS beta 本机上，Archive 必须通过 **Xcode Cloud**（仅手动触发的 Archive
工作流），保证 `BuildMachineOSBuild` 来自正式系统镜像——见
[iOS Xcode Cloud](ios-xcode-cloud.md)。Cloud 用产品「下一个构建版本编号」写入
`CFBundleVersion`；配置共享环境变量后，`ci_post_xcodebuild.sh` 会用
App Store Connect API Key 上传 App Store IPA。随后 Fastlane（`apps/ios` 的
`submit_review`）精确选择相同的 App Version 与 Build Number，提交 App Review，
并设置为审核通过后自动发布。元数据、协议、审核信息或凭据不完整时工作流会失败，
不会改为提交其他构建。
