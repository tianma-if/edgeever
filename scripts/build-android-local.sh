#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"
ANDROID_DIR="$MOBILE_DIR/android"
MODE="${1:-fast}"

if [[ "$MODE" != "fast" && "$MODE" != "apk" && "$MODE" != "play" ]]; then
  echo "用法: $0 [fast|apk|play]" >&2
  exit 2
fi

if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! command -v java >/dev/null 2>&1; then
  echo "未找到 Java 17。请先执行: brew install openjdk@17" >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" && -d /opt/homebrew/share/android-commandlinetools ]]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
fi
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
export NODE_ENV="${NODE_ENV:-production}"

run_timed() {
  local label="$1"
  shift
  local started_at=$SECONDS

  echo "[$(date '+%H:%M:%S')] 开始：${label}"
  "$@"
  echo "[$(date '+%H:%M:%S')] 完成：${label}（$((SECONDS - started_at)) 秒）"
}

if [[ -z "$ANDROID_SDK_ROOT" ]]; then
  echo "未找到 Android SDK，请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT。" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
run_timed "安装 JavaScript 依赖" bun install --frozen-lockfile
run_timed "准备移动端图标" bun run prepare:mobile:icons

PREBUILD_FINGERPRINT="$({
  shasum \
    apps/mobile/app.json \
    apps/mobile/assets/adaptive-icon-transparent.svg \
    apps/web/public/pwa-512x512.png \
    bun.lock
} | shasum | awk '{print $1}')"
PREBUILD_STAMP="$ANDROID_DIR/.edgeever-prebuild-fingerprint"
PREVIOUS_FINGERPRINT="$(test -f "$PREBUILD_STAMP" && cat "$PREBUILD_STAMP" || true)"

if [[ ! -x "$ANDROID_DIR/gradlew" || "$PREBUILD_FINGERPRINT" != "$PREVIOUS_FINGERPRINT" ]]; then
  echo "更新 Android 原生工程（保留已有编译缓存）..."
  cd "$MOBILE_DIR"
  run_timed "生成 Android 原生工程" bunx expo prebuild --platform android
  printf '%s' "$PREBUILD_FINGERPRINT" > "$PREBUILD_STAMP"
else
  echo "跳过 Android prebuild：原生配置未变化。"
fi

cd "$ANDROID_DIR"
COMMON_ARGS=(
  --build-cache
  --parallel
  --daemon
  -Dorg.gradle.jvmargs=-Xmx6g\ -XX:MaxMetaspaceSize=1g\ -Dfile.encoding=UTF-8
)

: "${ANDROID_KEYSTORE_FILE:?请设置 ANDROID_KEYSTORE_FILE（本地上传密钥路径）}"
: "${ANDROID_KEYSTORE_PASSWORD:?请设置 ANDROID_KEYSTORE_PASSWORD}"
: "${ANDROID_KEY_ALIAS:?请设置 ANDROID_KEY_ALIAS}"
: "${ANDROID_KEY_PASSWORD:?请设置 ANDROID_KEY_PASSWORD}"

PLAY_ARCHS="${EDGE_EVER_ANDROID_PLAY_ARCHS:-arm64-v8a}"
APK_ARCHS="${EDGE_EVER_ANDROID_APK_ARCHS:-arm64-v8a}"
KEYSTORE_FILE="$(cd "$(dirname "$ANDROID_KEYSTORE_FILE")" && pwd)/$(basename "$ANDROID_KEYSTORE_FILE")"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
APKSIGNER_PATH="$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner"

if [[ "$MODE" == "fast" ]]; then
  echo "构建生产签名 arm64 快速 APK（关闭 R8、资源压缩和 PNG crunch）..."
  run_timed "Gradle 快速 APK 构建" ./gradlew assembleRelease \
    "${COMMON_ARGS[@]}" \
    -PreactNativeArchitectures=arm64-v8a \
    -Pandroid.enableMinifyInReleaseBuilds=false \
    -Pandroid.enableShrinkResourcesInReleaseBuilds=false \
    -Pandroid.enablePngCrunchInReleaseBuilds=false \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
    -Pandroid.injected.signing.store.type=PKCS12
  test -s "$APK_PATH"
  test -x "$APKSIGNER_PATH"
  run_timed "校验 APK 固定签名" \
    node "$PROJECT_ROOT/scripts/verify-android-apk-signature.mjs" \
    "$APK_PATH" "$APKSIGNER_PATH"
  echo "完成: $APK_PATH"
  exit 0
fi

if [[ "$MODE" == "apk" ]]; then
  echo "构建生产签名 APK（${APK_ARCHS}）..."
  run_timed "Gradle 生产 APK 构建" ./gradlew assembleRelease \
    "${COMMON_ARGS[@]}" \
    -PreactNativeArchitectures="$APK_ARCHS" \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
    -Pandroid.injected.signing.store.type=PKCS12
  AAPT2_PATH="$ANDROID_SDK_ROOT/build-tools/36.0.0/aapt2"
  test -s "$APK_PATH"
  test -x "$APKSIGNER_PATH"
  test -x "$AAPT2_PATH"
  run_timed "校验 APK 固定签名" \
    node "$PROJECT_ROOT/scripts/verify-android-apk-signature.mjs" \
    "$APK_PATH" "$APKSIGNER_PATH"
  run_timed "读取 APK 信息" bash -c '"$1" dump badging "$2" | sed -n "1p"' _ "$AAPT2_PATH" "$APK_PATH"
  run_timed "计算 APK SHA-256" shasum -a 256 "$APK_PATH"
  echo "完成: $APK_PATH"
  exit 0
fi

echo "构建 Play 签名 AAB（${PLAY_ARCHS}）..."
run_timed "Gradle 生产 AAB 构建" ./gradlew bundleRelease \
  "${COMMON_ARGS[@]}" \
  -PreactNativeArchitectures="$PLAY_ARCHS" \
  -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
  -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD" \
  -Pandroid.injected.signing.store.type=PKCS12

AAB_PATH="app/build/outputs/bundle/release/app-release.aab"
PACKAGED_MANIFEST="app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml"
test -s "$PACKAGED_MANIFEST"
if grep -q "android.permission.REQUEST_INSTALL_PACKAGES" "$PACKAGED_MANIFEST"; then
  echo "Play AAB 的最终合并清单仍包含 REQUEST_INSTALL_PACKAGES，停止发布。" >&2
  exit 1
fi
ACTUAL_PLAY_ARCHS="$(unzip -Z1 "$AAB_PATH" | sed -n 's#^base/lib/\([^/]*\)/.*#\1#p' | sort -u | paste -sd, -)"
if [[ "$ACTUAL_PLAY_ARCHS" != "$PLAY_ARCHS" ]]; then
  echo "AAB 架构不符合预期：期望 ${PLAY_ARCHS}，实际 ${ACTUAL_PLAY_ARCHS:-无原生库}。" >&2
  exit 1
fi

run_timed "校验 AAB 签名" jarsigner -verify "$AAB_PATH"
test -s app/build/outputs/mapping/release/mapping.txt
echo "完成: $ANDROID_DIR/$AAB_PATH"
echo "反混淆文件: $ANDROID_DIR/app/build/outputs/mapping/release/mapping.txt"
