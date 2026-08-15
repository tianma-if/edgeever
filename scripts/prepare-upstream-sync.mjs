import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const protectedUpdaterPaths = [
  ".github/workflows",
  "scripts/prepare-upstream-sync.mjs",
  "scripts/upstream-sync-plan.mjs",
];

function runGit(arguments_, { allowFailure = false, cwd = process.cwd() } = {}) {
  try {
    const stdout = execFileSync("git", arguments_, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "", stdout };
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 1;
    const stderr = String(error.stderr || "");
    const stdout = String(error.stdout || "");
    if (allowFailure) return { status, stderr, stdout };

    const details = [stdout, stderr]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(`git ${arguments_.join(" ")} failed${details ? `:\n${details}` : ""}`);
  }
}

function resolveCommit(cwd, revision) {
  const result = runGit(["rev-parse", "--verify", `${revision}^{commit}`], { cwd });
  const commit = result.stdout.trim();
  if (!commit) {
    throw new Error(`git rev-parse returned no commit for ${revision} in ${cwd}`);
  }
  return commit;
}

function restoreProtectedUpdater(cwd, baseCommit) {
  for (const path of protectedUpdaterPaths) {
    const pathExists = runGit(["cat-file", "-e", `${baseCommit}:${path}`], {
      allowFailure: true,
      cwd,
    });

    if (pathExists.status === 0) {
      runGit(
        ["restore", `--source=${baseCommit}`, "--staged", "--worktree", "--", path],
        { cwd },
      );
    } else {
      runGit(["rm", "-r", "-f", "--ignore-unmatch", "--", path], { cwd });
    }
  }
}

function requireNoUpdaterChanges(cwd, baseCommit) {
  const result = runGit(
    ["diff", "--cached", "--quiet", baseCommit, "--", ...protectedUpdaterPaths],
    { allowFailure: true, cwd },
  );
  if (result.status === 1) {
    throw new Error("The downstream updater layer must remain unchanged in deployment forks");
  }
  if (result.status !== 0) {
    throw new Error(`Could not verify the protected updater layer (git diff exited ${result.status})`);
  }
}

function requirePreparedChanges(cwd, baseCommit) {
  const result = runGit(["diff", "--cached", "--quiet", baseCommit], {
    allowFailure: true,
    cwd,
  });
  if (result.status === 0) {
    throw new Error("The upstream sync plan requested an update, but no managed files changed");
  }
  if (result.status !== 1) {
    throw new Error(`Could not verify the prepared update (git diff exited ${result.status})`);
  }
}

function prepareSnapshot(cwd, baseCommit, targetCommit) {
  runGit(["read-tree", "--reset", "-u", targetCommit], { cwd });
  restoreProtectedUpdater(cwd, baseCommit);

  const managedTreeMatches = runGit(
    [
      "diff",
      "--cached",
      "--quiet",
      targetCommit,
      "--",
      ".",
      ":(exclude).github/workflows/**",
      ":(exclude)scripts/prepare-upstream-sync.mjs",
      ":(exclude)scripts/upstream-sync-plan.mjs",
    ],
    { allowFailure: true, cwd },
  );
  if (managedTreeMatches.status !== 0) {
    throw new Error("Prepared deployment tree does not match the selected upstream target");
  }
}

function resolveCustomizedMergeBase(cwd, baseCommit, targetCommit) {
  const message = runGit(
    [
      "log",
      "-1",
      "--grep=^EdgeEver-Upstream-Commit: ",
      "--format=%B",
      baseCommit,
    ],
    { cwd },
  ).stdout;
  const recordedRevision = message.match(/^EdgeEver-Upstream-Commit:\s*(\S+)\s*$/m)?.[1];
  if (recordedRevision) {
    const recordedCommit = runGit(
      ["rev-parse", "--verify", `${recordedRevision}^{commit}`],
      { allowFailure: true, cwd },
    );
    if (recordedCommit.status === 0 && recordedCommit.stdout.trim()) {
      return recordedCommit.stdout.trim();
    }
  }

  return runGit(["merge-base", baseCommit, targetCommit], { cwd }).stdout.trim();
}

function prepareCustomizedMerge(cwd, baseCommit, targetCommit) {
  const mergeBase = resolveCustomizedMergeBase(cwd, baseCommit, targetCommit);
  if (!mergeBase) throw new Error("Could not resolve the customized fork's upstream base");

  const replaceRef = `refs/replace/${baseCommit}`;
  if (runGit(["show-ref", "--quiet", "--verify", replaceRef], {
    allowFailure: true,
    cwd,
  }).status === 0) {
    throw new Error(`Refusing to overwrite existing Git replacement ${replaceRef}`);
  }

  const baseTree = runGit(["rev-parse", `${baseCommit}^{tree}`], { cwd }).stdout.trim();
  const syntheticCommit = runGit(
    [
      "commit-tree",
      baseTree,
      "-p",
      mergeBase,
      "-m",
      "temporary EdgeEver customized sync base",
    ],
    { cwd },
  ).stdout.trim();
  runGit(["replace", baseCommit, syntheticCommit], { cwd });

  let mergedTree = "";
  try {
    const merge = runGit(["merge", "--no-commit", "--no-ff", targetCommit], {
      allowFailure: true,
      cwd,
    });
    const mergeInProgress = runGit(["rev-parse", "--quiet", "--verify", "MERGE_HEAD"], {
      allowFailure: true,
      cwd,
    }).status === 0;

    if (merge.status !== 0 && !mergeInProgress) {
      const details = [merge.stdout, merge.stderr]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `Could not start the customized upstream merge${details ? `:\n${details}` : ""}`,
      );
    }

    restoreProtectedUpdater(cwd, baseCommit);
    const unresolved = runGit(["diff", "--name-only", "--diff-filter=U"], { cwd })
      .stdout.trim()
      .split("\n")
      .filter(Boolean);

    if (unresolved.length > 0) {
      throw new Error(`Customized fork conflicts with upstream in: ${unresolved.join(", ")}`);
    }
    if (!mergeInProgress) {
      throw new Error("Customized merge did not create a merge result");
    }

    mergedTree = runGit(["write-tree"], { cwd }).stdout.trim();
  } finally {
    runGit(["merge", "--abort"], { allowFailure: true, cwd });
    runGit(["replace", "-d", baseCommit], { allowFailure: true, cwd });
  }

  if (!mergedTree) throw new Error("Customized merge did not produce a tree");
  runGit(["read-tree", "--reset", "-u", mergedTree], { cwd });
}

export function prepareUpstreamSync({
  alignMode,
  baseRevision = "HEAD",
  cwd = process.cwd(),
  targetRevision,
}) {
  if (!targetRevision) throw new Error("targetRevision is required");
  if (!new Set(["merge", "snapshot"]).has(alignMode)) {
    throw new Error(`Unsupported upstream sync align mode: ${alignMode}`);
  }

  const trackedStatus = runGit(["status", "--porcelain=v1", "--untracked-files=no"], { cwd })
    .stdout.trim();
  if (trackedStatus) {
    throw new Error(`Upstream sync requires a clean tracked worktree:\n${trackedStatus}`);
  }

  const baseCommit = resolveCommit(cwd, baseRevision);
  const targetCommit = resolveCommit(cwd, targetRevision);

  if (alignMode === "snapshot") {
    prepareSnapshot(cwd, baseCommit, targetCommit);
  } else {
    prepareCustomizedMerge(cwd, baseCommit, targetCommit);
  }

  requireNoUpdaterChanges(cwd, baseCommit);
  requirePreparedChanges(cwd, baseCommit);

  return { alignMode, baseCommit, targetCommit };
}

function runCli() {
  if (process.argv[2] !== "prepare") {
    throw new Error("Usage: node scripts/prepare-upstream-sync.mjs prepare");
  }

  const result = prepareUpstreamSync({
    alignMode: process.env.EDGE_SYNC_ALIGN_MODE,
    baseRevision: process.env.EDGE_SYNC_BASE_COMMIT || "HEAD",
    targetRevision: process.env.EDGE_SYNC_TARGET_COMMIT,
  });
  process.stdout.write(
    `[ok] prepared ${result.alignMode} update ${result.baseCommit.slice(0, 12)} -> ${result.targetCommit.slice(0, 12)} without changing the downstream updater layer\n`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
