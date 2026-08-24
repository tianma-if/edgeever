import {
  createHash,
} from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { nativeReleaseAssetsReady } from "./check-native-release-assets.mjs";
import { planNativeRelease } from "./plan-native-release.mjs";

const DEFAULT_REPOSITORY = "tianma-if/edgeever";
const VERSION_BUMPS = new Set(["patch", "minor", "major"]);
const POLL_INTERVAL_MS = 10_000;
const RUN_DISCOVERY_TIMEOUT_MS = 60_000;
export const RELEASE_WORKFLOWS = {
  desktop: "desktop-build.yml",
  mobile: "mobile-build.yml",
  docker: "docker-image.yml",
  demo: "deploy-demo.yml",
};

export const RELEASE_VALIDATIONS = [
  { label: "Project regression tests", args: ["run", "test"] },
  { label: "Web typecheck", args: ["run", "typecheck"] },
  { label: "Mobile typecheck", args: ["run", "typecheck:mobile"] },
  { label: "Web build", args: ["run", "build:web"] },
  {
    label: "Native release planning tests",
    args: [
      "test",
      "scripts/plan-native-release.test.mjs",
      "scripts/check-native-release-assets.test.mjs",
      "scripts/release.test.mjs",
      "scripts/validate-store-delivery.test.mjs",
      "scripts/store-delivery.test.mjs",
      "scripts/configure-android-package-permissions.test.mjs",
      "scripts/download-play-universal-apk.test.mjs",
      "scripts/desktop-icns.test.mjs",
      "apps/web/src/lib/version-check.test.mjs",
      "apps/mobile/src/lib/mobile-release.test.ts",
    ],
  },
];

const usage = `Usage:
  bun run release -- \\
    --bump patch \\
    --issue-title "Release issue title" \\
    --label bug \\
    --change-en "English user-facing change" \\
    --change-zh "中文用户更新说明" \\
    --change-commit "abcdef1"

Repeat --change-en, --change-zh, and --change-commit for multiple paired release bullets.
Use comma-separated SHAs when one bullet covers multiple commits. Every other
commit requires --ignore-commit "abcdef1:reason".

Options:
  --bump <level>            Required version bump: patch, minor, or major
  --repository <owner/name>  GitHub repository (default: ${DEFAULT_REPOSITORY})
  --issue-title <title>      Required umbrella Issue title
  --label <label>            Required Issue label; may be repeated
  --change-en <text>         Required English release bullet; may be repeated
  --change-zh <text>         Required Chinese release bullet; may be repeated
  --change-locale <tag:text> Optional localized bullet; repeat once per change and locale
  --change-commit <sha,...>  Commits covered by the corresponding bilingual bullet
  --ignore-commit <sha:why>  Explicitly exclude a non-user-facing commit; may be repeated
  --install-desktop          Install and launch the final DMG after publication
  --dry-run                  Print the plan and generated notes without mutations
  --help                     Show this help
`;

export const parseReleaseArgs = (argv) => {
  const options = {
    repository: DEFAULT_REPOSITORY,
    bump: "",
    issueTitle: "",
    labels: [],
    changesEn: [],
    changesZh: [],
    localizedChanges: [],
    changeCommits: [],
    ignoredCommits: [],
    installDesktop: false,
    dryRun: false,
    help: false,
  };

  const valueOptions = new Map([
    ["--repository", "repository"],
    ["--bump", "bump"],
    ["--issue-title", "issueTitle"],
    ["--label", "labels"],
    ["--change-en", "changesEn"],
    ["--change-zh", "changesZh"],
    ["--change-locale", "localizedChanges"],
    ["--change-commit", "changeCommits"],
    ["--ignore-commit", "ignoredCommits"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--install-desktop") {
      options.installDesktop = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--help") {
      options.help = true;
      continue;
    }

    const key = valueOptions.get(argument);
    if (!key) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    index += 1;
    if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = value;
    }
  }

  if (options.help) {
    return options;
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
    throw new Error("--repository must use owner/name format.");
  }
  if (!VERSION_BUMPS.has(options.bump)) {
    throw new Error("--bump must be patch, minor, or major.");
  }
  if (!options.issueTitle) {
    throw new Error("--issue-title is required.");
  }
  if (options.labels.length === 0) {
    throw new Error("At least one --label is required.");
  }
  if (options.changesEn.length === 0 || options.changesZh.length === 0) {
    throw new Error("At least one --change-en and --change-zh are required.");
  }
  if (options.changesEn.length !== options.changesZh.length) {
    throw new Error("--change-en and --change-zh must have the same count.");
  }
  if (options.changesEn.length !== options.changeCommits.length) {
    throw new Error("Each bilingual change requires one corresponding --change-commit value.");
  }
  const localizedChanges = {};
  for (const value of options.localizedChanges) {
    const separator = value.indexOf(":");
    const locale = separator === -1 ? "" : value.slice(0, separator).trim();
    const change = separator === -1 ? "" : value.slice(separator + 1).trim();
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || !change) {
      throw new Error('--change-locale must use "<locale>:<user-facing change>".');
    }
    if (["en-us", "zh-cn"].includes(locale.toLowerCase())) {
      throw new Error("Use --change-en and --change-zh for en-US and zh-CN release changes.");
    }
    (localizedChanges[locale] ??= []).push(change);
  }
  for (const [locale, changes] of Object.entries(localizedChanges)) {
    if (changes.length !== options.changesEn.length) {
      throw new Error(`--change-locale ${locale} must provide one translation for every release change.`);
    }
  }
  options.localizedChanges = localizedChanges;
  return options;
};

const RELEASE_COMMIT_PATTERN = /^chore: release v\d+\.\d+\.\d+ \[skip ci\]$/;
const COMMIT_REF_PATTERN = /^[0-9a-f]{7,40}$/i;

const parseCommitRefs = (value, option) => {
  const refs = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (refs.length === 0 || refs.some((ref) => !COMMIT_REF_PATTERN.test(ref))) {
    throw new Error(`${option} must contain comma-separated commit SHAs with 7 to 40 hexadecimal characters.`);
  }
  return refs;
};

const resolveCommitRef = (ref, commits, option) => {
  const matches = commits.filter((commit) => commit.sha.toLowerCase().startsWith(ref.toLowerCase()));
  if (matches.length === 0) {
    throw new Error(`${option} references ${ref}, which is not in the release commit range.`);
  }
  if (matches.length > 1) {
    throw new Error(`${option} commit ${ref} is ambiguous; use a longer SHA.`);
  }
  return matches[0];
};

export const auditReleaseCommitCoverage = ({ commits, changeCommits, ignoredCommits }) => {
  const mappings = changeCommits.map((value, index) => ({
    changeIndex: index,
    commits: parseCommitRefs(value, "--change-commit").map((ref) =>
      resolveCommitRef(ref, commits, "--change-commit")
    ),
  }));
  const coveredShas = new Set(mappings.flatMap((mapping) =>
    mapping.commits.map((commit) => commit.sha)
  ));
  const ignored = ignoredCommits.map((value) => {
    const separator = value.indexOf(":");
    const ref = separator === -1 ? "" : value.slice(0, separator).trim();
    const reason = separator === -1 ? "" : value.slice(separator + 1).trim();
    if (!COMMIT_REF_PATTERN.test(ref) || !reason) {
      throw new Error('--ignore-commit must use "<commit-sha>:<reason>".');
    }
    const commit = resolveCommitRef(ref, commits, "--ignore-commit");
    if (coveredShas.has(commit.sha)) {
      throw new Error(`Commit ${ref} cannot be both covered and ignored.`);
    }
    return { commit, reason };
  });
  const ignoredShas = new Set(ignored.map(({ commit }) => commit.sha));
  if (ignoredShas.size !== ignored.length) {
    throw new Error("A commit may only be ignored once.");
  }

  const automatic = commits
    .filter((commit) => RELEASE_COMMIT_PATTERN.test(commit.subject))
    .map((commit) => ({ commit, reason: "release automation commit" }));
  const automaticShas = new Set(automatic.map(({ commit }) => commit.sha));
  const uncovered = commits.filter((commit) =>
    !coveredShas.has(commit.sha) && !ignoredShas.has(commit.sha) && !automaticShas.has(commit.sha)
  );
  if (uncovered.length > 0) {
    throw new Error([
      "Release notes do not account for every commit since the previous Release:",
      ...uncovered.map((commit) => `- ${commit.sha.slice(0, 8)} ${commit.subject}`),
      'Cover each commit with --change-commit, or use --ignore-commit "<sha>:<reason>".',
    ].join("\n"));
  }

  return { mappings, ignored: [...ignored, ...automatic] };
};

export const nextVersion = (version, bump) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a stable X.Y.Z version, received: ${version}`);
  }
  if (!VERSION_BUMPS.has(bump)) {
    throw new Error(`Expected patch, minor, or major bump, received: ${bump}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

export const resolveReleaseVersion = ({
  previousVersion,
  packageVersion,
  bump,
  headSha,
  draftCandidate = null,
  draftTargetIsAncestor = false,
}) => {
  const expectedNextVersion = nextVersion(previousVersion, bump);
  if (packageVersion === previousVersion) {
    return {
      releaseVersion: expectedNextVersion,
      releaseBaseTag: `v${previousVersion}`,
      resumedDraft: null,
      withdrawnDraft: null,
    };
  }

  if (
    !draftCandidate ||
    draftCandidate.tagName !== `v${packageVersion}` ||
    !draftCandidate.isDraft ||
    draftCandidate.isPrerelease
  ) {
    throw new Error(
      `package.json version ${packageVersion} must match ${previousVersion}, or a compatible stable Draft.`,
    );
  }

  if (draftCandidate.targetCommitish === headSha) {
    if (packageVersion !== expectedNextVersion) {
      throw new Error(
        `${draftCandidate.tagName} cannot resume because --bump ${bump} expects v${expectedNextVersion}.`,
      );
    }
    return {
      releaseVersion: packageVersion,
      releaseBaseTag: `v${previousVersion}`,
      resumedDraft: draftCandidate,
      withdrawnDraft: null,
    };
  }

  if (!draftTargetIsAncestor) {
    throw new Error(
      `${draftCandidate.tagName} is not compatible with the current HEAD or its history.`,
    );
  }

  return {
    releaseVersion: nextVersion(packageVersion, bump),
    // A withdrawn release does not become the audit baseline. Keep the latest
    // published release as the source for commit coverage, changed-file plans,
    // and reusable native assets so the replacement release stays cumulative.
    releaseBaseTag: `v${previousVersion}`,
    resumedDraft: null,
    withdrawnDraft: draftCandidate,
  };
};

export const buildReleaseTitle = (tag) => {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Expected a stable vX.Y.Z tag, received: ${tag}`);
  }
  return tag;
};

export const buildIssueBody = ({ changesEn, changesZh, commitCoverageAudit }) => [
  "## Summary",
  "",
  ...changesEn.map((change) => `- ${change}`),
  "",
  "## 中文说明",
  "",
  ...changesZh.map((change) => `- ${change}`),
  "",
  ...(commitCoverageAudit ? [
    "## Commit coverage audit",
    "",
    ...commitCoverageAudit.mappings.map((mapping) =>
      `- Change ${mapping.changeIndex + 1}: ${mapping.commits.map((commit) => `\`${commit.sha.slice(0, 8)}\``).join(", ")}`
    ),
    ...commitCoverageAudit.ignored.map(({ commit, reason }) =>
      `- Excluded \`${commit.sha.slice(0, 8)}\`: ${reason}`
    ),
    "",
  ] : []),
  "## Acceptance criteria",
  "",
  "- Required type checks, Web build, and native release planning tests pass.",
  "- The Draft Release contains audited macOS arm64 and x64 DMGs and an Android arm64 APK.",
  "- Post-publication native asset audits pass.",
].join("\n");

export const buildReleaseNotes = ({
  changesEn,
  changesZh,
  issueNumber,
}) => [
  "## 🇨🇳 中文说明 / Chinese Changelog",
  "",
  "## 主要更新",
  "",
  ...changesZh.map((change) => `- ${change}`),
  "",
  `关联 Issue：#${issueNumber}`,
  "",
  "## Key Changes",
  "",
  ...changesEn.map((change) => `- ${change}`),
  "",
  `Related Issue: #${issueNumber}`,
  "",
].join("\n");

export const buildReleaseSummary = ({ version, changesEn, changesZh, localizedChanges = {} }) => ({
  version,
  changes: {
    "en-US": [...changesEn],
    "zh-CN": [...changesZh],
    ...Object.fromEntries(Object.entries(localizedChanges).map(([locale, changes]) => [locale, [...changes]])),
  },
});

export const reusedAssetMatches = (previousAssets, currentAssets, name) => {
  const previous = previousAssets.find((asset) => asset.name === name);
  const current = currentAssets.find((asset) => asset.name === name);
  return Boolean(
    previous &&
    current &&
    previous.digest &&
    previous.digest === current.digest &&
    previous.size === current.size,
  );
};

export const selectPublishedDmg = (assets, arch = process.arch) => {
  if (!["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported macOS architecture for installation: ${arch}.`);
  }
  const matches = assets.filter((asset) =>
    new RegExp(`^EdgeEver-(.+)-mac-${arch}\\.dmg$`).test(asset.name)
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one macOS ${arch} DMG, found ${matches.length}.`);
  }
  const version = new RegExp(`^EdgeEver-(.+)-mac-${arch}\\.dmg$`).exec(matches[0].name)?.[1];
  if (!version || !matches[0].digest?.startsWith("sha256:")) {
    throw new Error("Published DMG is missing its version or SHA-256 digest.");
  }
  return { asset: matches[0], version };
};

const run = (executable, args, { capture = false, allowFailure = false } = {}) => {
  const result = spawnSync(executable, args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `${executable} ${args.join(" ")} exited with status ${result.status ?? 1}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return capture ? String(result.stdout ?? "").trim() : result;
};

const ghJson = (args) => JSON.parse(run("gh", args, { capture: true }));
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export const runParallelValidations = async ({
  executable = process.execPath,
  validations = RELEASE_VALIDATIONS,
} = {}) => {
  console.log(`[release] running ${validations.length} validations in parallel`);
  const results = await Promise.all(
    validations.map(({ label, args }) => new Promise((resolveValidation) => {
      console.log(`[release] start: ${label}`);
      const child = spawn(executable, args, {
        cwd: resolve("."),
        env: process.env,
        stdio: "inherit",
      });
      child.on("error", (error) => resolveValidation({ label, error }));
      child.on("exit", (code, signal) => resolveValidation({ label, code, signal }));
    })),
  );
  const failures = results.filter((result) => result.error || result.code !== 0);
  if (failures.length > 0) {
    throw new Error(
      `Release validation failed: ${failures.map(({ label }) => label).join(", ")}`,
    );
  }
  console.log("[release] all parallel validations passed");
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const changedFilesBetween = (baseRef, headRef) => run(
  "git",
  ["diff", "--name-only", `${baseRef}...${headRef}`],
  { capture: true },
).split("\n").filter(Boolean);

const releaseCommitsBetween = (baseRef, headRef) => run(
  "git",
  ["log", "--reverse", "--format=%H%x09%s", `${baseRef}..${headRef}`],
  { capture: true },
).split("\n").filter(Boolean).map((line) => {
  const separator = line.indexOf("\t");
  return {
    sha: line.slice(0, separator),
    subject: line.slice(separator + 1),
  };
});

const printReleaseCoverageAudit = ({ audit, changesEn }) => {
  console.log("[release] commit coverage audit:");
  for (const mapping of audit.mappings) {
    const commits = mapping.commits.map((commit) => commit.sha.slice(0, 8)).join(", ");
    console.log(`[release]   change ${mapping.changeIndex + 1} (${commits}): ${changesEn[mapping.changeIndex]}`);
  }
  for (const { commit, reason } of audit.ignored) {
    console.log(`[release]   ignored ${commit.sha.slice(0, 8)}: ${reason}`);
  }
};

const assertReleasePreconditions = ({ repository, previousTag }) => {
  if (run("git", ["branch", "--show-current"], { capture: true }) !== "main") {
    throw new Error("Releases must run directly from the main branch.");
  }
  if (run("git", ["status", "--porcelain"], { capture: true })) {
    throw new Error("The working tree must be clean before starting a release.");
  }
  run("git", ["fetch", "origin", "main", "--tags"]);
  const [behind, ahead] = run(
    "git",
    ["rev-list", "--left-right", "--count", "origin/main...main"],
    { capture: true },
  ).split(/\s+/).map(Number);
  if (behind !== 0 || ahead !== 0) {
    throw new Error("main must exactly match origin/main before starting a release.");
  }
  if (run("gh", ["auth", "status"], { allowFailure: true }).status !== 0) {
    throw new Error("GitHub CLI authentication is required.");
  }
  run("git", ["rev-parse", "--verify", `${previousTag}^{commit}`], { capture: true });
  const remote = run("gh", ["repo", "view", repository, "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { capture: true });
  if (remote !== repository) {
    throw new Error(`Unable to resolve repository ${repository}.`);
  }
};

const updateReleaseVersions = ({ nextVersion, desktopRebuild, mobileRebuild, changesEn, changesZh, localizedChanges }) => {
  const changedPaths = ["package.json", "release-summary.json"];
  const rootPackage = readJson("package.json");
  rootPackage.version = nextVersion;
  writeJson("package.json", rootPackage);
  writeJson("release-summary.json", buildReleaseSummary({
    version: nextVersion,
    changesEn,
    changesZh,
    localizedChanges,
  }));

  if (desktopRebuild) {
    const desktopPackage = readJson("apps/desktop/package.json");
    desktopPackage.version = nextVersion;
    writeJson("apps/desktop/package.json", desktopPackage);
    changedPaths.push("apps/desktop/package.json");
  }

  if (mobileRebuild) {
    const mobileConfig = readJson("apps/mobile/app.json");
    mobileConfig.expo.version = nextVersion;
    mobileConfig.expo.android.versionCode += 1;
    writeJson("apps/mobile/app.json", mobileConfig);
    changedPaths.push("apps/mobile/app.json");
  }
  return changedPaths;
};

const parseRunId = (output) => {
  const match = output.match(/\/actions\/runs\/(\d+)/);
  return match ? Number(match[1]) : null;
};

export const waitForRun = async ({
  repository,
  runId,
  label,
  viewRun = () => ghJson([
    "run",
    "view",
    String(runId),
    "--repo",
    repository,
    "--json",
    "status,conclusion,url,headSha",
  ]),
  waitForNextPoll = () => wait(POLL_INTERVAL_MS),
  maxConsecutiveFailures = 5,
}) => {
  let lastStatus = "";
  let consecutiveFailures = 0;
  while (true) {
    let runView;
    try {
      runView = viewRun();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        throw error;
      }
      console.warn(
        `[release] ${label}: GitHub status check failed; retrying (${consecutiveFailures}/${maxConsecutiveFailures - 1})`,
      );
      await waitForNextPoll();
      continue;
    }
    const statusLabel = `${runView.status}${runView.conclusion ? `/${runView.conclusion}` : ""}`;
    if (statusLabel !== lastStatus) {
      console.log(`[release] ${label}: ${statusLabel} (${runView.url})`);
      lastStatus = statusLabel;
    }
    if (runView.status === "completed") {
      if (runView.conclusion !== "success") {
        throw new Error(`${label} failed: ${runView.url}`);
      }
      return runView;
    }
    await waitForNextPoll();
  }
};

const listWorkflowRuns = ({ repository, workflow, event }) => ghJson([
  "run",
  "list",
  "--repo",
  repository,
  "--workflow",
  workflow,
  "--event",
  event,
  "--limit",
  "20",
  "--json",
  "databaseId,displayTitle,headSha,createdAt,url,status,conclusion",
]);

const dispatchReleaseWorkflow = async ({
  repository,
  workflow,
  tag,
  headSha,
}) => {
  const existingRunIds = new Set(
    listWorkflowRuns({
      repository,
      workflow,
      event: "workflow_dispatch",
    }).map((candidate) => candidate.databaseId),
  );
  const dispatchedAt = Date.now();
  const output = run("gh", [
    "workflow",
    "run",
    workflow,
    "--repo",
    repository,
    "--ref",
    "main",
    "-f",
    `release_tag=${tag}`,
  ], { capture: true });
  const returnedRunId = parseRunId(output);
  if (returnedRunId) {
    return returnedRunId;
  }

  const deadline = Date.now() + RUN_DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const match = listWorkflowRuns({
      repository,
      workflow,
      event: "workflow_dispatch",
    }).find((candidate) =>
      !existingRunIds.has(candidate.databaseId) &&
      candidate.headSha === headSha &&
      Date.parse(candidate.createdAt) >= dispatchedAt - 5_000
    );
    if (match) {
      return match.databaseId;
    }
    await wait(2_000);
  }
  throw new Error(`Timed out discovering dispatched ${workflow} run for ${tag}.`);
};

const findReleaseRun = async ({
  repository,
  workflow,
  tag,
  headSha,
  publishedAfter,
}) => {
  const deadline = Date.now() + RUN_DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const runs = listWorkflowRuns({ repository, workflow, event: "release" });
    const match = runs.find((candidate) =>
      candidate.displayTitle === tag &&
      candidate.headSha === headSha &&
      Date.parse(candidate.createdAt) >= publishedAfter - 5_000
    );
    if (match) {
      return match;
    }
    await wait(2_000);
  }
  throw new Error(`Timed out discovering ${workflow} for ${tag}.`);
};

const assertDraftAssets = ({
  assets,
  previousAssets,
  tag,
  version,
  desktopRebuild,
  mobileRebuild,
}) => {
  const assetNames = assets.map((asset) => asset.name);
  if (!nativeReleaseAssetsReady({
    platform: "desktop",
    rebuild: desktopRebuild,
    currentTag: tag,
    desktopVersion: version,
    assetNames,
  })) {
    throw new Error("Draft Release desktop assets are incomplete or incompatible.");
  }
  if (!nativeReleaseAssetsReady({
    platform: "mobile",
    rebuild: mobileRebuild,
    currentTag: tag,
    assetNames,
  })) {
    throw new Error("Draft Release Android assets are incomplete or incompatible.");
  }

  if (!mobileRebuild) {
    const previousApk = previousAssets.find((asset) =>
      /^edgeever-android-v.*-arm64-v8a\.apk$/.test(asset.name)
    );
    if (!previousApk || !reusedAssetMatches(previousAssets, assets, previousApk.name)) {
      throw new Error("Reused Android APK filename, size, or checksum changed.");
    }
  }
  if (!desktopRebuild) {
    const previousDesktopNames = previousAssets
      .map((asset) => asset.name)
      .filter((name) =>
        /^EdgeEver-.*-mac-(?:arm64|x64)\.(?:dmg|zip)(?:\.blockmap)?$/.test(name) ||
        name === "latest-mac.yml"
      );
    if (
      previousDesktopNames.length !== 9 ||
      !previousDesktopNames.every((name) =>
        reusedAssetMatches(previousAssets, assets, name)
      )
    ) {
      throw new Error("Reused desktop asset filename, size, or checksum changed.");
    }
  }
};

const sha256File = (path) => new Promise((resolveHash, rejectHash) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("error", rejectHash);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolveHash(hash.digest("hex")));
});

export const installPublishedDmg = async ({ repository, tag, assets }) => {
  if (process.platform !== "darwin") {
    throw new Error("Final DMG installation requires macOS.");
  }
  const { asset: dmg, version: nativeVersion } = selectPublishedDmg(assets);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "edgeever-release-"));
  const mountDirectory = join(temporaryDirectory, "mount");
  const dmgPath = join(temporaryDirectory, dmg.name);
  mkdirSync(mountDirectory);
  let mounted = false;
  let backupPath = "";

  try {
    run("gh", [
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--pattern",
      dmg.name,
      "--dir",
      temporaryDirectory,
    ]);
    const digest = await sha256File(dmgPath);
    if (`sha256:${digest}` !== dmg.digest) {
      throw new Error(`Downloaded DMG checksum mismatch: ${digest}`);
    }

    run("hdiutil", [
      "attach",
      dmgPath,
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountDirectory,
    ]);
    mounted = true;
    const sourceApp = join(mountDirectory, "EdgeEver.app");
    if (!existsSync(sourceApp)) {
      throw new Error("Mounted DMG does not contain EdgeEver.app.");
    }

    run("osascript", ["-e", 'tell application "EdgeEver" to quit'], { allowFailure: true });
    await wait(2_000);
    const installedApp = "/Applications/EdgeEver.app";
    if (existsSync(installedApp)) {
      const trashDirectory = join(process.env.HOME || "", ".Trash");
      if (!trashDirectory.startsWith(`${sep}Users${sep}`)) {
        throw new Error("Could not resolve a safe Trash directory for the previous app.");
      }
      backupPath = join(trashDirectory, `EdgeEver.app.pre-${tag}`);
      if (existsSync(backupPath)) {
        backupPath = `${backupPath}.${Date.now()}`;
      }
      renameSync(installedApp, backupPath);
    }
    try {
      run("ditto", [sourceApp, installedApp]);
      const installedVersion = run(
        "defaults",
        ["read", join(installedApp, "Contents/Info.plist"), "CFBundleShortVersionString"],
        { capture: true },
      );
      if (installedVersion !== nativeVersion) {
        throw new Error(
          `Installed app version is ${installedVersion}, expected reused native version ${nativeVersion}.`,
        );
      }
      run("codesign", ["--verify", "--deep", "--strict", installedApp]);
    } catch (error) {
      if (existsSync(installedApp) && backupPath) {
        renameSync(installedApp, `${backupPath}.failed-${Date.now()}`);
      }
      if (backupPath && existsSync(backupPath)) {
        renameSync(backupPath, installedApp);
      }
      throw error;
    }
    run("open", ["-a", installedApp]);
    console.log(
      `[release] installed and launched EdgeEver ${nativeVersion} from ${tag}`,
    );
    if (backupPath) {
      console.log(`[release] previous app backup: ${backupPath}`);
    }
  } finally {
    if (mounted) {
      run("hdiutil", ["detach", mountDirectory], { allowFailure: true });
    }
    if (temporaryDirectory.startsWith(`${tmpdir()}${sep}edgeever-release-`)) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
};

export const installReleaseDmg = async ({ repository, tag }) => {
  const published = ghJson([
    "release",
    "view",
    tag,
    "--repo",
    repository,
    "--json",
    "assets",
  ]);
  await installPublishedDmg({ repository, tag, assets: published.assets });
};

const releaseMain = async (options) => {
  const latestRelease = ghJson([
    "api",
    `repos/${options.repository}/releases/latest`,
    "--jq",
    "{tagName:.tag_name,assets:[.assets[]|{name,size,digest}]}",
  ]);
  const previousTag = latestRelease.tagName;
  assertReleasePreconditions({ repository: options.repository, previousTag });

  const rootPackage = readJson("package.json");
  const previousVersion = previousTag.replace(/^v/, "");
  const headShaBeforeRelease = run("git", ["rev-parse", "HEAD"], { capture: true });
  let draftCandidate = null;
  let draftTargetIsAncestor = false;
  if (rootPackage.version !== previousVersion) {
    draftCandidate = ghJson([
      "release",
      "view",
      `v${rootPackage.version}`,
      "--repo",
      options.repository,
      "--json",
      "tagName,isDraft,isPrerelease,targetCommitish,body,assets,url",
    ]);
    if (draftCandidate.targetCommitish !== headShaBeforeRelease) {
      draftTargetIsAncestor = run(
        "git",
        ["merge-base", "--is-ancestor", draftCandidate.targetCommitish, headShaBeforeRelease],
        { allowFailure: true },
      ).status === 0;
    }
  }
  const {
    releaseVersion,
    releaseBaseTag,
    resumedDraft,
    withdrawnDraft,
  } = resolveReleaseVersion({
    previousVersion,
    packageVersion: rootPackage.version,
    bump: options.bump,
    headSha: headShaBeforeRelease,
    draftCandidate,
    draftTargetIsAncestor,
  });
  const tag = `v${releaseVersion}`;
  if (withdrawnDraft) {
    console.log(
      `[release] ${withdrawnDraft.tagName} is a withdrawn Draft; reserving that version and continuing with ${tag}.`,
    );
  }
  const changedFiles = changedFilesBetween(releaseBaseTag, headShaBeforeRelease);
  if (changedFiles.length === 0) {
    throw new Error(`There are no committed changes after ${releaseBaseTag}.`);
  }
  const releaseCommits = releaseCommitsBetween(releaseBaseTag, headShaBeforeRelease);
  const commitCoverageAudit = auditReleaseCommitCoverage({
    commits: releaseCommits,
    changeCommits: options.changeCommits,
    ignoredCommits: options.ignoredCommits,
  });
  printReleaseCoverageAudit({ audit: commitCoverageAudit, changesEn: options.changesEn });
  const desktopPlan = planNativeRelease("desktop", changedFiles);
  const mobilePlan = planNativeRelease("mobile", changedFiles);

  console.log(`[release] ${releaseBaseTag} -> ${tag}`);
  console.log(`[release] desktop: ${desktopPlan.rebuild ? "rebuild" : "reuse"}`);
  console.log(`[release] Android: ${mobilePlan.rebuild ? "rebuild" : "reuse"}`);

  if (options.dryRun) {
    console.log(buildReleaseNotes({
      changesEn: options.changesEn,
      changesZh: options.changesZh,
      localizedChanges: options.localizedChanges,
      issueNumber: 0,
    }));
    return;
  }

  let issueNumber;
  let releaseSha;
  if (resumedDraft) {
    const issueMatch = resumedDraft.body.match(/Related Issue: #(\d+)/);
    if (!issueMatch) {
      throw new Error(`${tag} Draft notes do not contain a Related Issue number.`);
    }
    issueNumber = Number(issueMatch[1]);
    releaseSha = headShaBeforeRelease;
    console.log(`[release] resuming existing Draft: ${resumedDraft.url}`);
  } else {
    await runParallelValidations();

    const issueUrl = run("gh", [
      "issue",
      "create",
      "--repo",
      options.repository,
      "--title",
      options.issueTitle,
      ...options.labels.flatMap((label) => ["--label", label]),
      "--body",
      buildIssueBody({ ...options, commitCoverageAudit }),
    ], { capture: true });
    const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
    if (!issueMatch) {
      throw new Error(`Could not parse created Issue URL: ${issueUrl}`);
    }
    issueNumber = Number(issueMatch[1]);
    console.log(`[release] created Issue #${issueNumber}: ${issueUrl}`);

    const versionPaths = updateReleaseVersions({
      nextVersion: releaseVersion,
      desktopRebuild: desktopPlan.rebuild,
      mobileRebuild: mobilePlan.rebuild,
      changesEn: options.changesEn,
      changesZh: options.changesZh,
    });
    run("git", ["add", ...versionPaths]);
    run("git", ["diff", "--cached", "--check"]);
    run("git", ["commit", "-m", `chore: release ${tag} [skip ci]`]);
    run("git", ["push", "origin", "main"]);
    releaseSha = run("git", ["rev-parse", "HEAD"], { capture: true });

    const notes = buildReleaseNotes({
      changesEn: options.changesEn,
      changesZh: options.changesZh,
      issueNumber,
    });
    const draftUrl = run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      options.repository,
      "--target",
      releaseSha,
      "--title",
      buildReleaseTitle(tag),
      "--draft",
      "--notes",
      notes,
    ], { capture: true });
    console.log(`[release] Draft created: ${draftUrl}`);
  }

  const [desktopRunId, mobileRunId, dockerRunId] = await Promise.all([
    dispatchReleaseWorkflow({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.desktop,
      tag,
      headSha: releaseSha,
    }),
    dispatchReleaseWorkflow({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.mobile,
      tag,
      headSha: releaseSha,
    }),
    dispatchReleaseWorkflow({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.docker,
      tag,
      headSha: releaseSha,
    }),
  ]);
  await Promise.all([
    waitForRun({
      repository: options.repository,
      runId: desktopRunId,
      label: "Draft desktop assets",
    }),
    waitForRun({
      repository: options.repository,
      runId: mobileRunId,
      label: "Draft Android assets",
    }),
    waitForRun({
      repository: options.repository,
      runId: dockerRunId,
      label: "Draft Docker image",
    }),
  ]);

  const draft = ghJson([
    "release",
    "view",
    tag,
    "--repo",
    options.repository,
    "--json",
    "isDraft,isPrerelease,targetCommitish,body,assets",
  ]);
  if (!draft.isDraft || draft.isPrerelease || draft.targetCommitish !== releaseSha) {
    throw new Error("Draft Release metadata does not match the release commit.");
  }
  if (draft.body.includes("\\n")) {
    throw new Error("Release notes contain a literal \\\\n sequence.");
  }
  assertDraftAssets({
    assets: draft.assets,
    previousAssets: latestRelease.assets,
    tag,
    version: releaseVersion,
    desktopRebuild: desktopPlan.rebuild,
    mobileRebuild: mobilePlan.rebuild,
  });

  const publishedAt = Date.now();
  const releaseUrl = run("gh", [
    "release",
    "edit",
    tag,
    "--repo",
    options.repository,
    "--draft=false",
    "--latest",
  ], { capture: true });
  console.log(`[release] published: ${releaseUrl}`);

  const [desktopAudit, mobileAudit, dockerAudit] = await Promise.all([
    findReleaseRun({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.desktop,
      tag,
      headSha: releaseSha,
      publishedAfter: publishedAt,
    }),
    findReleaseRun({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.mobile,
      tag,
      headSha: releaseSha,
      publishedAfter: publishedAt,
    }),
    findReleaseRun({
      repository: options.repository,
      workflow: RELEASE_WORKFLOWS.docker,
      tag,
      headSha: releaseSha,
      publishedAfter: publishedAt,
    }),
  ]);
  const demoRuns = listWorkflowRuns({
    repository: options.repository,
    workflow: RELEASE_WORKFLOWS.demo,
    event: "release",
  });
  const demoRun = demoRuns.find((candidate) =>
    candidate.displayTitle === tag && candidate.headSha === releaseSha
  );
  console.log(
    demoRun
      ? `[release] Demo deployment continues in background: ${demoRun.url}`
      : `[release] Demo deployment continues in background: https://github.com/${options.repository}/actions/workflows/${RELEASE_WORKFLOWS.demo}`,
  );

  try {
    await Promise.all([
      waitForRun({
        repository: options.repository,
        runId: desktopAudit.databaseId,
        label: "Published desktop asset audit",
      }),
      waitForRun({
        repository: options.repository,
        runId: mobileAudit.databaseId,
        label: "Published Android asset audit",
      }),
      waitForRun({
        repository: options.repository,
        runId: dockerAudit.databaseId,
        label: "Published Docker image audit",
      }),
    ]);
  } catch (error) {
    run("gh", [
      "release",
      "edit",
      tag,
      "--repo",
      options.repository,
      "--draft=true",
    ], { allowFailure: true });
    throw error;
  }

  run("gh", [
    "issue",
    "comment",
    String(issueNumber),
    "--repo",
    options.repository,
    "--body",
    `Released in [${tag}](${releaseUrl}).\n\nRequired local validations, Draft asset and image preparation, and post-publication audits passed.`,
  ]);
  run("gh", [
    "issue",
    "close",
    String(issueNumber),
    "--repo",
    options.repository,
    "--reason",
    "completed",
  ]);
  console.log(`[release] ${tag} is complete; Demo deployment is not blocking completion`);

  if (options.installDesktop) {
    await installReleaseDmg({
      repository: options.repository,
      tag,
    });
  }
};

if (import.meta.main) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
    } else {
      await releaseMain(options);
    }
  } catch (error) {
    console.error(`[release] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
