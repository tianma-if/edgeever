# 正文生成自动输出预算（#652 PR A）

[English](2026-11-04-ai-auto-output-budget.md)

关联 Issue：#652

## 问题与目标

#780 之后，正文生成的输出上限仍默认固定为 4096：支持 32K 甚至更多输出的模型在长文翻译、润色、续写时被截断；结果被截断时界面也不提示，用户可能用不完整的结果替换原文。本 PR 按 #652 确认的范围实现 PR A：

- 正文生成默认使用自动预算，按实际连接的供应商或网关支持的上限分配；手动预算保留为高级设置并优先生效。
- 能读到上限时按上限分配；读不到时不再固定 4096。
- 结果不完整（达到上限或被停止）时明确提示，并禁止用它替换原文或选区。

分段、续接、Web / 桌面侧栏正文命令和选区翻译、侧栏草稿恢复属于 PR B，不在本 PR 范围内。

## 允许变更与验收

1. **上限读取（客户端）**：由客户端读取供应商的模型元数据，只发 GET 请求，不产生生成费用。
   - Anthropic `GET /models/{id}`：`max_tokens` 和 `max_input_tokens`（上下文窗口，输入输出共用）。
   - Gemini `GET /models/{id}`：`outputTokenLimit` 和 `inputTokenLimit`（相互独立）。
   - OpenAI 兼容 `GET /models`：OpenRouter 的 `top_provider.max_completion_tokens` 和 `context_length`（共用窗口）、DeepSeek 的 `max_output_tokens` 和 `context_window`（共用窗口）。读不到时再尝试 LiteLLM 的 `/model/info`（`max_output_tokens` / `max_input_tokens`，相互独立）。
   - 网络、认证、限流或服务端错误视为“未知”，不上报；接口正常响应但没有上限信息（OpenAI、NewAPI、one-api 等），或网关对不支持的元数据路径返回 400 / 404 时，上报 `none`，7 天内不再重复读取。
2. **存储（服务端）**：迁移 `0092` 给 `ai_models` 增加 `detected_max_output_tokens`、`detected_max_input_tokens`、`detected_context_window_tokens`、`detected_capability_source`、`detected_at`，均可为空。新增 `PUT /api/v1/ai/providers/:providerConfigId/models/:modelConfigId/capabilities`：校验数值范围和来源；只接受与当前保存的模型 ID、服务类型、Base URL 和配置版本（供应商配置的 `updated_at`）一致的上报，并在写入的同一条语句里再次核对，上报途中配置被修改时不会覆盖新配置（否则 409）；沿用用户会话、工作区隔离和 Demo / 只读限制。修改服务类型或 Base URL 时清空该服务下模型的检测结果。
3. **预算计算（服务端 prepare，共享纯函数）**：
   - 手动预算优先。
   - 上限已知时：续写、扩写、自定义指令等开放式任务可用到可用上限；翻译、校对、润色、简化、改语气、精简等输出与原文相当的任务按原文估算所需（不低于原来的 4096），不超过可用上限。
   - 只有供应商给出输入输出共用窗口时（Anthropic、DeepSeek、OpenRouter）才从窗口中扣除本次输入估算和余量；独立的输入上限（Gemini、LiteLLM）只用于判断输入能否放下，不扣减输出预算。
   - 自动预算不会超过共用窗口的剩余空间，剩余很少时也一样。输入超过输入上限或窗口已无剩余时，prepare 返回 413 `ai_input_too_long` 并给出明确提示，不再发送注定被上游拒绝的请求；手动预算不做这项基于估算的检查。
   - 上限未知时：声明支持的新客户端（请求里带 `allowUnboundedOutput: true`）不发送输出上限，由上游按默认值输出；Anthropic 必须带 `max_tokens`，仍为 4096；旧客户端仍为 4096。
   - prepare 响应的 `maxOutputTokens` 对新客户端可以为 `null`，另返回 `outputBudget`（模式、可用上限、输入是否放得下）；并返回 `capabilityTarget`（上报位置和配置版本）；检测结果缺失或超过 7 天时 `detectCapabilities` 为 `true`，提示客户端读取。
4. **客户端流程（Web、桌面、Android 共用 `packages/client`）**：prepare 的 `detectCapabilities` 为真时先读取上限、上报，再重新 prepare 一次，让本次请求就使用新上限。上游返回可识别的“输出上限过大”400 时（例如 Anthropic 的 `max_tokens: X > Y`），按该上限只重试一次；即使缓存未过期也会上报，偏高的缓存值会被纠正，之后的请求直接使用新上限；错误文案无法识别时不重试。完成事件带 `truncated`，统一识别 `length`、`max_tokens`、`model_context_window_exceeded`、`MAX_TOKENS`。同时修正了 Anthropic 结束原因的读取：流式响应把它放在 `message_delta` 的 `delta.stop_reason` 里，此前各端都读顶层字段，始终拿不到。Web 网络兜底的转发白名单只额外放行读取单个模型元数据和 LiteLLM `/model/info` 的 GET 请求。
5. **截断保护**：只有流正常结束的结果才能替换原文。以下情况都算不完整：上游报告达到上限；结果有本次请求的开始标记却没有结束标记（实测有网关在截断后仍报告 `stop`）；用户停止；收到部分正文后连接断开或流报错；流结束时既没有供应商的结束原因、也没有结束标记（无论是否收到开始标记）。Android 的 AI 助手和编辑器选区面板、iOS 的 AI 助手在结果不完整或被用户停止时显示提示，并禁用“替换”和“替换选中内容”；复制和追加 / 插入仍可用。iOS 解码 `null` 预算，未知上限时不发送 `max_tokens` / `maxOutputTokens`（Anthropic 仍发送）。文案覆盖 5 种语言。
6. **设置界面（Web / 桌面）**：正文生成预算的占位文字改为“自动”；预算对话框显示检测到的上限、来源和时间，以及“检测上限 / 重新检测”。

## 保持不变的边界、风险与恢复

- 标签建议（300）和伴读（2048）的默认值不变；手动预算的语义不变。
- 只升级服务端时，旧客户端在检测结果存在后也会得到自动预算（单个数值），未检测时仍为 4096；新客户端连接旧服务端时不会读取上限，按原来的数值请求，截断提示照常生效。
- 最坏情况：
  - 上限读取或估算偏差导致请求的上限超过上游实际支持，上游返回 400。错误能识别时会自动按正确上限重试一次并记住；不能识别时报错，用户可以填写手动预算。
  - 未知上限时不发送上限，个别网关的默认值可能较小，结果会被截断；此时会明确标记，不能直接替换原文。
  - Token 估算偏保守，长度非常接近共用窗口的笔记可能被 `ai_input_too_long` 拒绝，而上游其实能接受。填写手动预算可跳过这项检查。
- 预算放宽后输出可以更长，费用和耗时随之增加；OpenRouter 等按 `max_tokens` 预占余额的平台，翻译等任务仍按所需估算，不会一律申请到上限。
- 回滚：回退代码即可。新列对旧代码没有影响（旧代码查询 `ai_models` 时显式列出列名），不需要回滚迁移。

## 实现与验收结论

- 自动化：shared（上限解析、截断原因、预算规划，含 Gemini 长输入不扣输出预算、窗口仅剩 300 token 与窗口耗尽的用例；草稿完成判定）、API（上报接口的校验、权限和合并规则；prepare 在新 / 旧客户端、手动 / 自动、共用 / 独立窗口、过期检测下的结果；服务类型或 Base URL 变化时清空；端点变更插在上报校验与写入之间、同一 URL 切换服务类型时拒绝旧报告；窗口仅剩 300 token 与窗口耗尽；0091 → 0092 升级）、client（各供应商读取、400 视为无上限、重新 prepare、400 重试、缺结束标记判定截断、未过期但偏高的缓存经一次 400 纠正并在下次直接使用、收到部分正文后断流或流报错仍判定不完整、未带标记的正文片段后无结束原因直接关流判定为中断）、Web 中继白名单、Playwright（预算对话框显示“自动”和检测状态）、iOS 单元测试（解码 `null`、未知上限不发送、截断识别、结束标记、只有正常结束才允许替换、无结束原因时只有收到结束标记才算完整）。`bun run typecheck`、`bun run typecheck:mobile`、`bun run build:web` 通过；`bun run test` 中只有在 `main` 上同样失败的 `deployment-entrypoints`；`bun run lint` 通过。
- 真实服务验收（预览实例，本分支客户端直连；测试长文为 40 节中文 Markdown，约 17,700 字，含 41 个标题、8 个代码块、40 个链接和 1 张表格）：
  - 能读到上限（Anthropic）：通过一个原样转发 Anthropic 官方 Models API 和 Messages API 的 Claude 网关测试，未直接调用 `api.anthropic.com`。按 Anthropic 类型配置，`claude-haiku-4-5-20251001` 读到输出上限 64,000、共用窗口 200,000（来源 `anthropic-models`）。翻译和全文润色都请求了 `max_tokens=45166`，输出分别为 10,560 和 16,780 token，40 节完整、结构全部保留，无需手填预算；结束原因可读到 `end_turn`。
  - 能读到上限（DeepSeek）：DeepSeek 官方接口（`deepseek-flash`，读到输出上限 393,216、共用窗口 1,048,576）。40 节中文长文的翻译和全文润色都请求了 `max_tokens=45166`，输出分别为 11,415 和 10,694 token，正常结束、未截断，40 节完整，标题、代码块、链接和表格全部保留，无需手填预算。
  - 能读到上限（Gemini 官方）：Gemini 官方接口 `generativelanguage.googleapis.com/v1beta`，`gemini-3-flash-preview` 读到输出上限 65,536、独立输入上限 1,048,576（来源 `gemini-models`），输入上限不扣减输出预算。翻译和全文润色都请求了 `maxOutputTokens=45166`，输出分别为 11,014 和 11,312 token，结束原因 `STOP`、未截断，40 节完整、结构全部保留，无需手填预算。
  - 读不到上限（Gemini 格式）：一个 OpenAI 兼容网关同时提供 Gemini 原生生成接口，但模型元数据接口返回 404（记为 `none`）。按 Gemini 类型配置，`gemini-3-flash-preview` 的请求不发送 `maxOutputTokens`；翻译和全文润色输出分别为 12,244 和 14,698 token，结束原因 `STOP`，40 节完整、结构全部保留。修改前这里会固定发送 4096。
  - 读不到上限（OpenAI 兼容）：同一网关的 OpenAI 兼容接口（模型列表无上限字段，记为 `none`），请求不发送 `max_tokens`；网关对不支持的元数据路径返回 400，同样记为 `none`，不会每次生成都重复读取。DeepSeek V4 Flash 的全文润色输出 8,574 token 并完整保留结构；DeepSeek 和 Claude Haiku 4.5 的翻译也完整。Claude Haiku 4.5 的全文润色被该网关在约 8192 token 处截断：网关不理会客户端传的 `max_tokens`（请求 4096 和 32000 时都输出 8,195 token），Anthropic 原生接口和 OpenAI 兼容接口都一样，且仍报告正常结束（OpenAI 兼容为 `stop`，Anthropic 为 `end_turn`）；在它前面再加一层 Cloudflare AI Gateway 转发，三种格式的结果相同：Claude Haiku 4.5 的润色仍在 8,195 token 处被截断并被识别，Gemini 格式的 `gemini-3-flash-preview` 完整输出 15,328 token；客户端依据缺失的结束标记判定为截断，界面提示并禁止替换。同一模型经上面的 Claude 网关可完整输出 16,780 token，说明这是该网关对 Claude Haiku 4.5 的硬性上限，需要 PR B 的分段来完整交付。该上限只针对这个模型：按该网关官方快速入门文档的配置（OpenAI 兼容 `/v1`、Anthropic `/v1/messages`、Gemini `/gemini_cli/v1beta`），直连和经 Cloudflare AI Gateway 转发时，`deepseek-flash`（OpenAI 兼容）、`claude-opus-5-5`（Anthropic）、`gemini-3-flash-preview`（Gemini）的全文润色都完整输出 40 节（11,450–18,107 token），三种格式都读不到上限（记为 `none`）。该网关同样不理会 Anthropic 格式请求的 `max_tokens`：未知上限时客户端按 Anthropic 要求发送 4096，Opus 仍输出 18,048 token。
- 跨版本（自托管 SQLite，同一数据目录）：旧服务端（`main`，0091）→ 本分支（0092）→ 回滚到旧服务端，共 29 项检查通过。覆盖本分支客户端、已发布的 v2.19.0 客户端和 Web 网络兜底，以及能读到上限的网关、没有上限的网关、Anthropic 风格 400 后按 2048 重试并记住。
- Cloudflare D1（隔离预览实例）：从 0091 加已有用户、模型和已保存预算升级到 0092，配置和预算不变；旧客户端仍为 4096 并被提示检测；新客户端不发送上限；上报后自动预算生效（独立输入上限不扣减输出）；手动预算优先。回滚到 `main` 后读写正常。
- iOS：Fork 的 Actions 上 Xcode 构建和单元测试通过。另在 Fork 的 Actions 上用模拟器跑 XCUITest，真实 App 连接自托管服务端和模拟供应商：完整结果可以替换；`length` 结束、缺结束标记但报告 `stop`、用户停止、收到两段正文后连接被切断、未带标记的正文片段后无结束原因直接关流，这五种情况都保留已收到的文字，显示对应提示并禁用“替换”，追加仍可用。
- Android 真机：在真实设备上安装预览 APK，连接预览实例手工测试 40 节长文。AI 助手与编辑器选区面板的翻译、润色可完整输出；用户停止时显示“已停止”，网关硬性截断时显示“结果不完整”，两种情况下“替换”和“替换选中内容”均被禁用，再次生成后恢复。全部符合预期。
- Android 真机（评审修复后的新预览 APK，连接预览实例）：AI 助手和选区面板生成中途打开飞行模式，已收到的文字保留，提示“生成中途中断”，“替换”和“替换选中内容”禁用，复制和追加 / 插入可用，正常重新生成后恢复；窗口记为 8000 token 的模型下，长文直接提示超出上下文窗口、不发请求，短文正常完成；网关实际只允许 64000、缓存记为 128000 时生成正常完成，实例上的上限被纠正为 64000。
- 未验证：iOS 真机；Anthropic 官方接口仅通过转发它的网关测试；OpenRouter 未做真实请求（解析逻辑有单元测试）。
