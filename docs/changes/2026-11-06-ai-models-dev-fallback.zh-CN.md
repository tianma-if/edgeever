# 模型上限读不到时以 models.dev 兜底（#652）

[English](2026-11-06-ai-models-dev-fallback.md)

关联 Issue：#652

## 问题与目标

#791 之后，客户端会读取供应商的模型元数据来确定输出上限和上下文窗口。但 OpenAI 官方接口和很多网关（NewAPI、one-api 等）的模型列表不带上限，检测结果记为 `none`：上限未知时请求不带输出上限，Anthropic 固定为 4096，分段也无从估算。

本次在供应商没有返回任何上限时，改用公共目录 [models.dev](https://github.com/anomalyco/models.dev) 兜底。

## 允许变更与验收

1. **触发与优先级**：只有供应商的元数据接口正常响应、但没有任何上限（`none`）时才查询 models.dev。供应商自己返回的上限始终优先，两者不混用。读不到供应商元数据（网络、认证、限流、服务端错误）时仍视为“未知”，不使用目录。
2. **执行位置**：由客户端（`packages/client`，Web、桌面、Android 共用）下载 `https://models.dev/api.json`。该地址允许任意来源跨域访问，直接请求，不经过实例的模型转发。下载的是整份目录，请求里不包含用户的模型 ID 或服务地址。服务端不访问 models.dev。
3. **匹配规则**（`packages/shared/src/ai-models-dev.ts`，不区分大小写，不做模糊匹配，按顺序）：
   - 先按 Base URL 的 host 匹配目录中供应商的 `api` 字段（如 `api.deepseek.com`、`openrouter.ai`）；host 为 `api.openai.com`，或服务类型为 Anthropic、Gemini 时，对应官方条目。命中则使用该供应商自己的条目。
   - 否则查找模型键或 `canonical_model_id` 与 ID 完全相同的条目；不带 `vendor/` 前缀的 ID 还可以匹配 canonical 的模型部分。沿这些条目记录的 canonical ID 找到原厂条目时使用原厂条目，例如 `openai/gpt-4o-mini` 使用 OpenAI 的 `gpt-4o-mini`。
   - 不会为了匹配而去掉未知前缀：目录没有记录 `my-team/gpt-5` 这个完整 ID 时，它不会套用 OpenAI `gpt-5` 的上限，仍记为 `none`。网关在未知前缀后面实际接的是什么模型无法确认，而结果会写入实例、被所有客户端共用。
   - 没有原厂条目时，对各中转条目的每个数值取下中位数，避免个别数据异常的条目左右结果。
   - 只额外去掉 `models/` 前缀；不猜测日期、版本或 `-thinking` 一类后缀，匹配不到时仍记为 `none`。
4. **字段映射**：有 `limit.input` 时，输入、输出上限相互独立；只有 `input + output` 超过 `context` 时才同时保留 `context` 作为共用窗口。没有 `input` 时，`context` 视为输入输出共用的窗口。0、负数和超大值视为未知。
5. **存储**：结果以来源 `models-dev` 写入现有的 `ai_models.detected_*` 列，沿用 7 天有效期和配置变更时清空的规则。之后遇到可识别的“输出上限过大”400，仍按 `provider-error` 纠正输出上限并保留来源。**没有数据库迁移。**
6. **缓存**：
   - 实例缓存（主缓存）：每个模型的结果保存在实例上，所有设备共享，每个模型每 7 天最多查询一次目录。
   - 客户端内存：解析后的精简索引保留 24 小时，期间不再发请求；并发查询共用一次下载。过期后重新请求：能读到 ETag 的环境（Android）带 `If-None-Match`，目录未变时只收到 304；models.dev 没有向浏览器暴露 ETag，Web 和桌面发普通 GET，由浏览器自身的 HTTP 缓存重新验证。重新请求失败时继续使用旧索引。
   - 失败处理：请求 5 秒超时，响应用户中止；失败后 10 分钟内不再重试，本次检测仍记为 `none`。设置里的“重新检测”可随时手动重试。
   - 不在本地数据库中持久化目录。
7. **设置界面**：来源显示为“models.dev 公共目录（参考值）”，覆盖全部 9 种界面语言。

## 保持不变的边界、风险与恢复

- iOS 原生端目前不读取上限，本次不变，另开 PR 补齐；其他端写入实例后，iOS 在 prepare 时同样使用这些结果。
- 新客户端连接旧服务端时，旧服务端不认识 `models-dev`，上报被拒绝，行为与之前相同。
- 最坏情况：目录给出的是官方上限，第三方网关的实际上限可能更低。网关返回可识别的 400 时会自动纠正一次；静默截断时由截断保护标记为不完整并禁止替换原文。目录数值偏低时只会多分段。
- 无法访问 models.dev 的网络中，首次检测最多多等 5 秒，之后按 `none` 处理，7 天内不再查询。
- 回滚：回退代码即可。旧代码把未知来源 `models-dev` 当作 `none`，预算回到原来的逻辑。

## 实现与验收结论

- 自动化：shared（目录解析、字段映射、匹配规则、`independent input` 长输入不扣输出预算；匹配用例放在 `packages/shared/test-fixtures/models-dev/`，供 iOS 复用）、client（缓存复用、ETag 304（Android）、失败退避、过期副本兜底、中止不影响共享下载；仅在 `none` 时兜底、供应商上限优先、读不到供应商时不兜底；生成流程中上报 `models-dev` 并用于同一次请求）、API（`models-dev` 上报的存储与使用，以及之后的 `provider-error` 纠正）。
- 用真实目录（2026-11-06 下载，约 8,800 条）抽查 `gpt-5`、`gpt-4o`、`claude-sonnet-4-5-20250929`、`gemini-2.5-flash`、`deepseek-chat`、`qwen3-max`、`glm-4.6`、`hy3` 等常见 ID，结果均来自原厂条目或合理的中转中位数；`my-team/gpt-5`、`xxxyyy/claude-opus-5-5` 这类目录未记录的带前缀 ID 不匹配。
- 真实服务（隔离预览实例）：Android 客户端（instabox Android 14 容器，x86_64 预览 APK）在模型上限为空时检测并上报。模拟网关（模型列表不带上限）下，`gpt-5` 记为 `models-dev` 并请求 `max_tokens=128000`，`my-team-model` 未匹配，请求不带上限（按评审意见收紧匹配规则后，用当前客户端代码复测，`xxxyyy/claude-opus-5-5` 记为 `none`）；一个只返回 `none` 的真实第三方网关，OpenAI 兼容、Anthropic、Gemini 三种协议都由目录补上上限并正常完成，其文字模型命中率为 39/56。
- Web 与桌面：Chromium 访问预览实例的线上构建，以及本分支打包的 Linux x64 AppImage（页面来源 `edgeever-app://app`），中英文设置弹窗的来源文案正确；“重新检测”时页面直接请求 models.dev（200，未被跨域拦截，未经实例转发）并写回上限。
- 中国大陆网络可访问 models.dev。
- 未验证：USB 真机（instabox 为容器环境，不替代真机验证）、macOS / Windows 桌面安装包、其余 7 种语言的界面展示。
