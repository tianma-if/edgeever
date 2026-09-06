# Contributing to EdgeEver

[简体中文](CONTRIBUTING.zh-CN.md) | English

Thank you for contributing to EdgeEver. A Fork used for Cloudflare deployment can also be used for code contributions, but deployment and development must use different branches.

## Keep the deployment branch separate

If your Fork is used to deploy EdgeEver:

- Treat the Fork's `main` as a deployment-only branch managed by **Update deployed EdgeEver**.
- Do not develop features directly on that `main` branch.
- Do not use GitHub **Sync fork** to update the deployment `main` during routine development or deployment updates.
- Create each contribution branch directly from the official repository's latest `upstream/main`.

The deployment workflow only updates the Fork's `main`. It does not modify your contribution branches.

## Create a contribution branch

Clone your Fork and add the official repository as `upstream`:

```sh
git clone https://github.com/<your-account>/edgeever.git
cd edgeever
git remote add upstream https://github.com/tianma-if/edgeever.git
git fetch upstream
```

Create a new branch from the official latest `main`, not from the deployment branch:

```sh
git switch -c feat/short-description upstream/main
```

Make and commit your changes, then push the contribution branch to your Fork:

```sh
git push -u origin feat/short-description
```

Open a Pull Request from:

```text
<your-account>/edgeever:feat/short-description
    -> tianma-if/edgeever:main
```

Your Fork's `main` does not need to match the official `main` for this Pull Request. GitHub uses the contribution branch as the Pull Request source.

## Synchronize an in-progress contribution

When the official repository changes, update the contribution branch without touching the deployment `main`:

```sh
git fetch upstream
git switch feat/short-description
git rebase upstream/main
```

If the branch was already pushed, update it safely with:

```sh
git push --force-with-lease origin feat/short-description
```

Resolve any conflicts on the contribution branch. Do not resolve them by synchronizing the deployment `main`.

## Verify your changes

Install dependencies and run the checks relevant to your change. The core validation commands are:

```sh
bun install
bun run test
bun run typecheck
bun run typecheck:mobile
bun run build:web
```

Platform-specific changes may require additional checks.

## Customized deployments

Keeping personal product changes permanently on the deployed `main` is a customized deployment, not the normal contribution workflow. Customized deployments must opt in with `EDGE_EVER_PRESERVE_FORK_CHANGES=true` and maintain their own upstream merges. You do not need this setting when contributing through a separate branch.
