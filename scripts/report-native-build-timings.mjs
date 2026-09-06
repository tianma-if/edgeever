import { readFileSync, writeFileSync } from "node:fs";

const TARGETS = {
  desktop: [
    {
      name: "macOS arm64",
      jobName: "macOS arm64",
      packageSteps: ["Package desktop installer"],
    },
    {
      name: "macOS x64",
      jobName: "macOS x64",
      packageSteps: ["Package desktop installer"],
    },
    {
      name: "Windows x64 Preview",
      jobName: "Windows x64 unsigned Preview",
      packageSteps: ["Package unsigned Windows installer"],
    },
  ],
  android: [
    {
      name: "Android arm64",
      jobName: "Build Android packages",
      packageSteps: [
        "Build signed release APK for GitHub Release",
        "Build fast main-branch APK",
      ],
    },
  ],
};

function timestamp(value) {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function durationMs(startedAt, completedAt) {
  const start = timestamp(startedAt);
  const end = timestamp(completedAt);
  return start === null || end === null || end < start ? null : end - start;
}

export function formatDuration(milliseconds) {
  if (milliseconds === null) return "—";
  const seconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function normalizeStep(step) {
  return {
    name: step.name,
    conclusion: step.conclusion ?? null,
    startedAt: step.started_at ?? null,
    completedAt: step.completed_at ?? null,
    durationMs: durationMs(step.started_at, step.completed_at),
  };
}

export function createTimingReport(payload, platform, metadata = {}) {
  const targets = TARGETS[platform];
  if (!targets) throw new Error(`Unsupported timing platform: ${platform}`);
  if (!Array.isArray(payload?.jobs)) throw new Error("Actions jobs response must contain a jobs array");

  const results = targets.map((target) => {
    const job = payload.jobs.find((candidate) => candidate.name === target.jobName);
    if (!job) {
      const available = payload.jobs.map((candidate) => candidate.name).join(", ");
      throw new Error(`Missing Actions job “${target.jobName}”. Available jobs: ${available}`);
    }

    const steps = (job.steps ?? []).map(normalizeStep);
    const packageCandidates = target.packageSteps
      .map((name) => steps.find((candidate) => candidate.name === name))
      .filter(Boolean);
    const packageStep = packageCandidates.find((candidate) => candidate.durationMs !== null)
      ?? packageCandidates[0]
      ?? null;
    const jobStart = timestamp(job.started_at);
    const jobEnd = timestamp(job.completed_at);
    const packageStart = timestamp(packageStep?.startedAt);
    const packageEnd = timestamp(packageStep?.completedAt);

    return {
      name: target.name,
      jobName: target.jobName,
      conclusion: job.conclusion ?? null,
      startedAt: job.started_at ?? null,
      completedAt: job.completed_at ?? null,
      totalDurationMs: durationMs(job.started_at, job.completed_at),
      preparationDurationMs: jobStart !== null && packageStart !== null ? packageStart - jobStart : null,
      packageDurationMs: packageStep?.durationMs ?? null,
      finalizationDurationMs: packageEnd !== null && jobEnd !== null ? jobEnd - packageEnd : null,
      packageStep: packageStep?.name ?? null,
      steps,
    };
  });

  return {
    schemaVersion: 1,
    platform,
    repository: metadata.repository ?? null,
    runId: metadata.runId ?? null,
    runAttempt: metadata.runAttempt ?? null,
    commit: metadata.commit ?? null,
    targets: results,
  };
}

export function renderTimingMarkdown(report) {
  const lines = [
    "## Native build timings",
    "",
    "The values below come from GitHub Actions job and step timestamps; the native build processes are not instrumented.",
    "",
    "| Target | Result | Total job | Before package | Package / notarize | After package |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const target of report.targets) {
    lines.push(
      `| ${target.name} | ${target.conclusion ?? "unknown"} | ${formatDuration(target.totalDurationMs)} | ${formatDuration(target.preparationDurationMs)} | ${formatDuration(target.packageDurationMs)} | ${formatDuration(target.finalizationDurationMs)} |`,
    );
  }

  lines.push("", "### Slowest recorded steps", "", "| Target | Step | Duration |", "| --- | --- | ---: |");
  for (const target of report.targets) {
    const slowest = target.steps
      .filter((step) => step.durationMs !== null && !step.name.startsWith("Post "))
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 5);
    for (const step of slowest) {
      lines.push(`| ${target.name} | ${step.name.replaceAll("|", "\\|")} | ${formatDuration(step.durationMs)} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "end"}`);
    options[key.slice(2)] = value;
  }
  for (const required of ["input", "platform", "json", "markdown"]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  return options;
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2));
  const payload = JSON.parse(readFileSync(options.input, "utf8"));
  const report = createTimingReport(payload, options.platform, {
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    commit: process.env.GITHUB_SHA,
  });
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.markdown, renderTimingMarkdown(report));
}
