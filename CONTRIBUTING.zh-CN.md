# 为 EdgeEver 贡献代码

简体中文 | [English](CONTRIBUTING.md)

感谢您为 EdgeEver 贡献代码。用于 Cloudflare 部署的 Fork 也可以提交代码贡献，但部署与开发必须使用不同的分支。

## 将部署分支与贡献分支分开

如果您的 Fork 用于部署 EdgeEver：

- 将 Fork 的 `main` 视为仅用于部署的分支，并交由 **Update deployed EdgeEver** 管理。
- 不要直接在这个 `main` 分支上开发功能。
- 日常开发和部署更新时，不要通过 GitHub **Sync fork** 更新部署用的 `main`。
- 每项代码贡献都应从官方仓库最新的 `upstream/main` 创建独立分支。

部署更新工作流只会更新 Fork 的 `main`，不会修改您的贡献分支。

## 创建贡献分支

克隆您的 Fork，并将官方仓库添加为 `upstream`：

```sh
git clone https://github.com/<您的账号>/edgeever.git
cd edgeever
git remote add upstream https://github.com/tianma-if/edgeever.git
git fetch upstream
```

从官方最新的 `main` 创建新分支，不要从部署分支开始开发：

```sh
git switch -c feat/简短说明 upstream/main
```

完成修改并提交后，将贡献分支推送到您的 Fork：

```sh
git push -u origin feat/简短说明
```

然后创建以下 Pull Request：

```text
<您的账号>/edgeever:feat/简短说明
    -> tianma-if/edgeever:main
```

提交这个 Pull Request 时，您的 Fork `main` 不需要与官方 `main` 保持一致。GitHub 使用的是贡献分支，而不是部署分支。

## 为开发中的贡献同步上游代码

官方仓库有新提交时，直接更新贡献分支，不要改动部署用的 `main`：

```sh
git fetch upstream
git switch feat/简短说明
git rebase upstream/main
```

如果该分支已经推送过，请安全地更新远端贡献分支：

```sh
git push --force-with-lease origin feat/简短说明
```

如有冲突，请在贡献分支中解决，不要通过同步部署用的 `main` 来处理。

## 验证修改

安装依赖并运行与改动相关的检查。核心验证命令包括：

```sh
bun install
bun run test
bun run typecheck
bun run typecheck:mobile
bun run build:web
```

特定平台的改动可能还需要额外检查。

## 定制部署

如果您希望将个人产品改动长期保留在部署用的 `main`，这属于定制部署，而不是普通的代码贡献流程。定制部署需要设置 `EDGE_EVER_PRESERVE_FORK_CHANGES=true`，并自行维护与上游的合并。使用独立分支贡献代码时不需要设置这个变量。
