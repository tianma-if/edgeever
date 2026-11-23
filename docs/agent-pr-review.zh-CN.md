# PR 跟踪评审执行细则

通用规则见 [GitHub 协作](../AGENTS.md#github-协作) 和 [巡检共用约定](../AGENTS.md#巡检共用约定)。

## 巡检范围

每轮核对所有打开的 PR（含 Draft）及未结项，跟踪 head/base、回复、CI 和 PR 状态。

## 自动批准 PR 的 Test 工作流

巡检自动批准外部 Fork PR 中符合以下条件的待批准 Test run。

- PR 仍打开，目标为 `tianma-if/edgeever:main`。run 位于官方仓库，由 `pull_request` 触发，其 head 仓库、分支和 SHA 与当前 PR 一致。GitHub API 未返回关联 PR 时，用这三项唯一匹配官方仓库的打开 PR。
- run 的工作流 ID 对应官方 `.github/workflows/test.yml`。工作流及其引用的本地 Action 和可复用工作流未被 PR 修改，并且 PR 作业只在 GitHub 托管 Runner 上以只读权限运行，无需 secrets 或受保护环境。条件无法确认时记录原因，留给维护者核查。
- 重新确认 head SHA 和待批准状态后，通过 `gh api --method POST "repos/tianma-if/edgeever/actions/runs/<run-id>/approve"` 单独批准该 run。记录 run 链接、head SHA 和确认后的运行状态。
- 自动授权仅限该 Test run。

## 评审与多轮跟进

- 问题标记为“待作者修改／待验证／已解决”，附核验依据。
- 优先用远程代码和 CI 证据，执行待审代码须在当前工作区之外。修改作者代码须另行授权。

## 合并确认

达到可合并标准时，先在 PR 评论评审通过、等待确认，再请维护者确认。两处均附 head SHA、验证结果及已知基线失败，确认请求另附 PR 链接和风险摘要。同一版本和结论各发一次。

## 状态记录

`prs.json` 分别记录扫描、评审和回复进度，保存 head/base SHA、已读和已发的评论及评审 ID、问题状态、待办、验证结果、可合并评论 ID 及确认请求对应的 SHA。
