# PR 跟踪评审执行细则

通用规则见 [GitHub 协作](../AGENTS.md#github-协作) 和 [巡检共用约定](../AGENTS.md#巡检共用约定)。

## 巡检范围

每轮核对所有打开的 PR（含 Draft）及未结项，跟踪 head/base、回复、CI 和 PR 状态。

## 自动批准 PR 的 Test 工作流

自动批准仅限符合以下条件的外部 Fork PR 的待批准 Test run。

- PR 仍打开，目标为 `tianma-if/edgeever:main`。run 位于官方仓库，由 `pull_request` 触发，其 head 仓库、分支和 SHA 与当前 PR 一致。GitHub API 未返回关联 PR 时，用这三项唯一匹配官方仓库的打开 PR。
- run 的工作流 ID 对应官方 `.github/workflows/test.yml`。工作流及其引用的本地 Action 和可复用工作流未被 PR 修改，并且 PR 作业只在 GitHub 托管 Runner 上以只读权限运行，无需 secrets 或受保护环境。条件无法确认时记录原因，留给维护者核查。
- 重新确认 head SHA 和待批准状态后，通过 `gh api --method POST "repos/tianma-if/edgeever/actions/runs/<run-id>/approve"` 单独批准该 run。记录 run 链接、head SHA 和确认后的运行状态。

## 评审边界

执行待审代码须在当前工作区之外。修改作者代码须另行授权。

## 合并确认

- 当前 head 达到可合并标准时，先在 PR 留言说明评审通过、等待确认，添加 `awaiting-merge-confirmation` 标签并核对已生效，再请维护者确认。留言和确认请求均附 head SHA、验证结果和已知基线失败。同一 head SHA 和结论各发一次。标签仅表示等待确认。
- 每轮复核已贴标签的 PR。head 更新、base 变动使原结论需重验、出现合并阻塞项、转为 Draft 或关闭时，移除该标签并核对。复审通过后可重新添加。

## 状态记录

`prs.json` 分别记录扫描、评审和回复进度，保存 head/base SHA、已读和已发的评论及评审 ID、问题状态、待办、验证结果，以及可合并评论 ID、已核实的标签状态和确认请求对应的 SHA。
