# iOS 原生端检测模型上限（#652）

[English](2026-11-09-ios-model-limits.md)

关联 Issue：#652

## 问题与目标

#791 和 #809 之后，Web、桌面、Android 共用 `packages/client`，会在模型上限缺失或过期时读取供应商元数据，读不到时用 models.dev 兜底，并把结果保存到实例；遇到可识别的“输出上限过大” 400 时自动纠正并重试一次。

iOS 原生端（Swift）没有这部分逻辑：不解析 prepare 返回的 `capabilityTarget` / `detectCapabilities`，不检测，遇到这类 400 直接报错。所以只用 iOS 的用户，模型上限始终未知（请求不带输出上限，Anthropic 固定 4096），偏高的缓存上限在 iOS 上也无法自动纠正。

本次让 iOS 与其他客户端行为一致。

## 允许变更与验收

1. **解码**：`AiPreparedGeneration` 解码 `capabilityTarget`、`detectCapabilities`；旧服务端不返回时为空，不检测。
2. **检测（`AiModelCapabilities.swift`、`AiModelCapabilityDetector.swift`）**：规则与 `packages/shared/src/ai-model-capabilities.ts`、`ai-models-dev.ts`、`packages/client/src/ai-model-capabilities-direct.ts` 一致。
   - 供应商元数据：Anthropic / Gemini 单模型接口；OpenAI 兼容 `/models`（OpenRouter、DeepSeek 格式），没有时再试 LiteLLM `/model/info`。区分共用窗口与独立输入、输出上限。
   - 供应商正常响应但没有任何上限时，用 models.dev 兜底：精确匹配，不去掉未知前缀。
   - 网络、认证、限流或服务端错误视为“未知”，不上报；`/model/info` 也一样，只有接口不支持（400、404 等）才算“没有上限”，暂时读取失败不会覆盖实例上已有的上限。
   - 检测请求携带模型密钥，不跟随重定向（与共享客户端的 `redirect: "error"` 一致），重定向视为“未知”，重定向目标收不到请求。正文生成和标签建议直连模型服务时同样不跟随重定向，遇到重定向按请求失败提示（此前 iOS 会带着密钥跟随，Web、桌面、Android 早已拒绝）。
   - 整段检测（元数据加 models.dev）最多 8 秒；超时视为“未知”，不上报，本次生成直接使用第一次 prepare 的结果。
3. **models.dev 缓存**：解析后的索引在内存中保留 24 小时；过期后带 `If-None-Match` 重新验证，目录未变时只收到 304；超时 5 秒；失败后 10 分钟内不重试，重新验证失败时继续使用旧索引；并发请求共用一次下载。不写入本地存储。
4. **生成流程**：prepare 要求检测时，读取上限并上报（`PUT .../capabilities`），有结果则重新 prepare，本次请求就使用新上限；上限未过期时不重复检测。供应商返回可识别的“输出上限过大” 400 时，按其给出的上限只重试一次，并以 `provider-error` 上报。
5. **共享客户端同步修正**：`packages/client` 读取 `/model/info` 时，认证、限流、服务端或网络错误此前被当作“没有上限”并上报 `none`；现在与 iOS 一致，视为“未知”，不上报。
6. **两端一致**：供应商元数据和报错信息的解析用例移到 `packages/shared/test-fixtures/model-capabilities/`，与 `packages/shared/test-fixtures/models-dev/` 一起由 TypeScript 和 Swift 测试共同读取。
7. **工程文件**：用 XcodeGen 重新生成 `EdgeEver.xcodeproj` 以加入新文件；之前手工加入的 TOTP 文件条目也随之按 XcodeGen 规范重排，不影响构建内容。

## 保持不变的边界、风险与恢复

- 服务端、Web、桌面、Android 不变，没有数据库迁移。
- 新 iOS 连旧服务端：旧服务端不返回 `capabilityTarget`，不检测，行为与之前相同。早于 #809 的服务端会拒绝 `models-dev` 来源的上报，iOS 忽略，不影响生成。
- 生成接口本身会重定向的网关（例如 http 跳转 https）在 iOS 上会直接提示失败，与其他客户端一致；需把 Base URL 改成最终地址。
- `/model/info` 对普通密钥返回 401/403 的网关，此后每次缺少上限时都会重新检测（每次多两次元数据请求），而不是记为“没有上限”七天内不再检测。
- 最坏情况：解析偏高时，第一次请求会收到 400，经一次重试纠正；解析偏低时只会多分段。模型上限缺失或过期时，生成前先检测，最多等待 8 秒。
- 回滚：回退 iOS 代码即可。

## 实现与验收结论

- 自动化：Swift 单元测试（共享的供应商元数据、报错信息和 models.dev 匹配用例；检测时各供应商的请求路径与请求头；只在“没有上限”时兜底、供应商上限优先、读不到时不兜底、未知前缀不匹配；目录缓存的共享下载、24 小时复用、ETag 304、失败退避；“输出上限过大” 400 只重试一次并上报；检测、正文生成和标签建议都不跟随重定向，重定向目标收不到请求；检测超时后不上报、直接生成；`/model/info` 返回 401/403/429/500/503 时为“未知”；完整生成流程：检测、上报、重新 prepare，本次请求使用新上限；上限未过期时不检测）。TypeScript 端改为同时读取共享用例，并补充 `/model/info` 暂时失败的用例。
- 用真实 models.dev 目录（约 8,800 条）对 4,234 个模型 ID 逐一比较，Swift 与 TypeScript 的匹配结果完全一致。
- 未验证：iOS 真机。
