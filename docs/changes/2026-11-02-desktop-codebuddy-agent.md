# Add CodeBuddy as a desktop local agent

[简体中文](2026-11-02-desktop-codebuddy-agent.zh-CN.md)

Related Issue: #758

## Problem and outcome

WorkBuddy and CodeBuddy share accounts and quota, but the desktop WorkBuddy integration depends on private details of the CLI bundled inside the WorkBuddy app (the lite-wb bundle, `--serve`, the credential encryption module), so WorkBuddy updates often break the connection (for example #584 and #600). Add a separate **CodeBuddy** option that runs the standard stdio ACP of the official CLI the user installs (`@tencent-ai/codebuddy-code`). WorkBuddy users can switch to it.

## Allowed changes and acceptance

1. Add a single CodeBuddy option with no China / international split; the CLI picks the region from the sign-in method. Clear inherited `CODEBUDDY_INTERNET_ENVIRONMENT` and `CODEBUDDY_INTERNET_ENVIROMENT` at launch so the endpoint cannot disagree with the sign-in.
2. Use only the standalone official CLI: never WorkBuddy's bundled CLI (paths inside `app.asar` are rejected and the package name is checked), and no `--serve`, credential bridge or gateway sign-in. Launch `node <package>/bin/codebuddy --acp`. On POSIX, check every `codebuddy` on the PATH and the desktop tool directories in order:
   - Symbolic links are followed to the official entry.
   - asdf, mise and Volta shims are resolved through the manager's own `which` (cached per shim for 30 seconds).
   - An invalid candidate moves on to the next one, so it never hides a later valid install.
   - nvm's default alias may be a full or partial version (such as `22`), `node` / `stable`, `lts/*` or a named alias. On Windows, find npm's `codebuddy.cmd` and use the entry in the `node_modules` beside it, without running the `.cmd` or using `shell: true`. Prefer the Node in the npm prefix that installed the CLI, then the shim directory, and report `node_missing` when none is found.
3. Sign in through the standard ACP `authenticate`, reusing the existing 5-minute sign-in timeout. The CLI opens the browser itself, so EdgeEver does not open it again. `_codebuddy.ai/authUrl` is handled only during a CodeBuddy sign-in the user started; a validated link stays in the main process for a manual "Reopen sign-in page" (repeat clicks within 3 seconds are ignored). The allowlist holds only the verified `copilot.tencent.com` (WeChat) and `codebuddy.ai` (Google / GitHub) and their subdomains, and rejects non-https links, user info and non-default ports. Enterprise domains are not included. A rejected link records only a fixed diagnostic code, never the URL or its query.
4. A `_codebuddy.ai/getUserInfo` response without `userInfo` or a token counts as signed out. Tokens never cross IPC or appear in logs. After `authenticate` returns, a fresh CLI process must restore the sign-in before success is reported.
5. Cancel works through the UI, IPC and the process lifecycle: it ends the CLI process and removes its temporary workspace. Switching to another agent or leaving the settings page also cancels a sign-in in progress. Results distinguish cancelled, timed out and failed. Closing the browser page is not a cancel.
6. Front end: agent list, AI sidebar, official logo (source recorded in `sources.json`) and strings in five languages. Only the verified WeChat method is labelled as China; other methods keep the CLI's name. When the CLI is missing, the hint shows `npm i -g @tencent-ai/codebuddy-code`.

## Boundaries, risks and recovery

- The change is concentrated in the new `codebuddy-cli.mjs` and the CodeBuddy branch of `acp-host.mjs` (sign-in flow and IPC for cancel and reopen). The shared `connect` gained an account-check parameter and an `authUrl` callback. WorkBuddy's existing check is unchanged, but this is a shared path, so other agents need regression testing.
- EdgeEver's own accounts, storage and migrations are untouched. Revert the commit to roll back; the user's CodeBuddy sign-in lives in the CLI's own configuration directory and is unaffected.
- iOA and enterprise-domain sign-ins are not on the allowlist: the CLI still opens the browser itself, but EdgeEver's "Reopen sign-in page" is unavailable for them.

## Implementation and acceptance

- Unit tests: command resolution and not installed (POSIX, Windows `.cmd`, nvm Node, other packages, WorkBuddy's bundled copy, missing Node; asdf, mise and Volta shims; invalid candidates not hiding later installs; nvm `22`, `lts/*`, `node` and named aliases, plus a real-filesystem regression finding the CLI through `lts/*` with a minimal PATH), clearing region variables, the link allowlist, handling `authUrl` only during sign-in, duplicate notifications and reopen throttling, timeout and cancel (including process exit), missing credentials, the fresh-process check after sign-in, and IPC permissions.
- Real macOS (CodeBuddy CLI 2.164.0 via Homebrew), using a minimal Finder-like PATH:
  - Resolution found `/opt/homebrew/bin/node` and the official entry.
  - With `CODEBUDDY_INTERNET_ENVIRONMENT=selfhosted` set, the connection check still reported available, and a real chat replied "OK".
  - With an isolated empty configuration, the check reported sign-in required and listed the CLI's four methods.
  - The WeChat sign-in produced a `copilot.tencent.com` link, and reopen throttling worked.
  - Cancel ended the sign-in as cancelled in about one second, with no leftover process.
  - Leaving the sign-in unfinished ended it as a timeout.
  - Diagnostics contained no sign-in link parameters.

  WeChat sign-in, keeping the sign-in after a restart, and independence from WorkBuddy accounts were verified earlier with the same CLI (see #758).
- macOS desktop UI (development Electron with the official v2.16.1 sidecar and an isolated app profile):
  - With the signed-in CLI, the check reported a usable session. The logo and sign-in labels were correct ("微信登录（国内）"; other methods keep the CLI's names).
  - With an empty CLI configuration, the card showed "Sign in to CodeBuddy".
  - Clicking the WeChat sign-in showed the in-progress hint, "Reopen sign-in page" and "Cancel sign-in".
  - Cancelling showed "Sign-in cancelled" and left no process.
  - Switching to Codex during sign-in ended the CLI process.
- `bun run typecheck`, `bun run typecheck:mobile`, `bun run build:web` and `bun run lint` passed. The only failure in the full non-E2E suite, `tests/deployment-entrypoints.test.ts`, also fails on unchanged `main` and is unrelated.
- Unsigned test installers (built by a temporary workflow on the fork):
  - Linux arm64 (Ubuntu 24.04, AppImage run after extraction). Setup:
    - Node 22 and CodeBuddy CLI 2.179.2 were installed under `~/.local`.
    - The desktop session PATH did not include `~/.local/bin`.
    - The system Node was v18.19.1, below the CLI's requirement.

    Results:
    - Launched from the app menu, the app still found the CLI and the Node 22 beside it.
    - The check reported sign-in required.
    - The WeChat sign-in opened the login page in the browser, and cancel worked.
    - After a QR sign-in, the sign-in survived an app restart.
    - A real chat replied "OK".
    - Logs contained no sign-in link or token.
  - macOS arm64 (DMG, locally ad-hoc signed): opened from Launchpad, the check reported a usable session and a real chat replied "OK".
  - Windows x64 (NSIS installer, CLI installed with npm): manual testing of the connection check, sign-in and chat passed.
- Not verified: iOA and enterprise-domain sign-in; a full Google / GitHub sign-in; token expiry and refresh; real-device regression for other agents (unit tests only); real nvm, asdf, mise and Volta installs (unit tests only).
