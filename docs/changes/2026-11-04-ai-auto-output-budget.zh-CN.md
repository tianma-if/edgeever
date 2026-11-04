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
   - 网络、认证或服务端错误视为“未知”，不上报；接口正常响应但没有上限信息（OpenAI、NewAPI、one-api 等）时上报 `none`，7 天内不再重复读取。
2. **存储（服务端）**：迁移 `0092` 给 `ai_models` 增加 `detected_max_output_tokens`、`detected_max_input_tokens`、`detected_context_window_tokens`、`detected_capability_source`、`detected_at`，均可为空。新增 `PUT /api/v1/ai/providers/:providerConfigId/models/:modelConfigId/capabilities`：校验数值范围和来源；只接受与当前保存的模型 ID 和 Base URL 一致的上报（否则 409）；沿用用户会话、工作区隔离和 Demo / 只读限制。修改服务类型或 Base URL 时清空该服务下模型的检测结果。
3. **预算计算（服务端 prepare，共享纯函数）**：
   - 手动预算优先。
   - 上限已知时：续写、扩写、自定义指令等开放式任务可用到可用上限；翻译、校对、润色、简化、改语气、精简等输出与原文相当的任务按原文估算所需（不低于原来的 4096），不超过可用上限。
   - 只有供应商给出输入输出共用窗口时（Anthropic、DeepSeek、OpenRouter）才从窗口中扣除本次输入估算和余量；独立的输入上限（Gemini、LiteLLM）只用于判断输入能否放下，不扣减输出预算。
   - 上限未知时：声明支持的新客户端（请求里带 `allowUnboundedOutput: true`）不发送输出上限，由上游按默认值输出；Anthropic 必须带 `max_tokens`，仍为 4096；旧客户端仍为 4096。
   - prepare 响应的 `maxOutputTokens` 对新客户端可以为 `null`，另返回 `outputBudget`（模式、可用上限、输入是否放得下）；检测结果缺失或超过 7 天时返回 `capabilityTarget`，提示客户端读取并上报。
4. **客户端流程（Web、桌面、Android 共用 `packages/client`）**：prepare 返回 `capabilityTarget` 时先读取上限、上报，再重新 prepare 一次，让本次请求就使用新上限。上游返回可识别的“输出上限过大”400 时（例如 Anthropic 的 `max_tokens: X > Y`），上报该上限并只重试一次；错误文案无法识别时不重试。完成事件带 `truncated`，统一识别 `length`、`max_tokens`、`model_context_window_exceeded`、`MAX_TOKENS`。Web 网络兜底的转发白名单只额外放行读取单个模型元数据和 LiteLLM `/model/info` 的 GET 请求。
5. **截断保护**：Android 的 AI 助手和编辑器选区面板、iOS 的 AI 助手在结果因达到上限而截断或被用户停止时显示提示，并禁用“替换”和“替换选中内容”；复制和追加 / 插入仍可用。iOS 解码 `null` 预算，未知上限时不发送 `max_tokens` / `maxOutputTokens`（Anthropic 仍发送）。文案覆盖 5 种语言。
6. **设置界面（Web / 桌面）**：正文生成预算的占位文字改为“自动”；预算对话框显示检测到的上限、来源和时间，以及“检测上限 / 重新检测”。

## 保持不变的边界、风险与恢复

- 标签建议（300）和伴读（2048）的默认值不变；手动预算的语义不变。
- 只升级服务端时，旧客户端在检测结果存在后也会得到自动预算（单个数值），未检测时仍为 4096；新客户端连接旧服务端时不会读取上限，按原来的数值请求，截断提示照常生效。
- 最坏情况：
  - 上限读取或估算偏差导致请求的上限超过上游实际支持，上游返回 400。错误能识别时会自动按正确上限重试一次并记住；不能识别时报错，用户可以填写手动预算。
  - 未知上限时不发送上限，个别网关的默认值可能较小，结果会被截断；此时会明确标记，不能直接替换原文。
- 预算放宽后输出可以更长，费用和耗时随之增加；OpenRouter 等按 `max_tokens` 预占余额的平台，翻译等任务仍按所需估算，不会一律申请到上限。
- 回滚：回退代码即可。新列对旧代码没有影响（旧代码查询 `ai_models` 时显式列出列名），不需要回滚迁移。

## 实现与验收结论

（验证完成后补充）
