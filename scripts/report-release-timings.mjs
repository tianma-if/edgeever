import { readFileSync, writeFileSync } from "node:fs";
import { durationMs, formatDuration } from "./report-native-build-timings.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const timestamp = (value) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const runDurationMs = (run) =>
  durationMs(run.run_started_at ?? run.created_at, run.updated_at);

const findJob = (payload, name) =>
  payload.jobs.find((candidate) => candidate.name === name) ?? null;

const findStep = (job, name) =>
  job?.steps?.find((candidate) => candidate.name === name) ?? null;

const jobDurationMs = (job) =>
  job ? durationMs(job.started_at, job.completed_at) : null;

const stepDurationMs = (step) =>
  step ? durationMs(step.started_at, step.completed_at) : null;

const resultOf = (candidate) =>
  candidate?.conclusion ?? candidate?.status ?? "unknown";

const escapeCell = (value) => String(value ?? "—").replaceAll("|", "\\|");

const runLink = (url) => (url ? `[Run](${url})` : "—");

function componentRow({ target, mode, candidate, duration, detail, url }) {
  return {
    target,
    mode,
    result: resultOf(candidate),
    durationMs: duration,
    detail,
    url,
  };
}

function nativeRows(payload, platform, requestedMode) {
  if (platform === "desktop") {
    const architectureJobs = [
      { name: "macOS arm64", packageStep: "Package desktop installer", detail: "package + notarize" },
      { name: "macOS x64", packageStep: "Package desktop installer", detail: "package + notarize" },
      { name: "Windows x64 unsigned Preview", packageStep: "Package unsigned Windows installer", detail: "package" },
    ]
      .map((target) => ({ target, job: findJob(payload, target.name) }))
      .filter(({ job }) => Boolean(job));
    if (architectureJobs.length > 0) {
      return architectureJobs.map(({ target, job }) => {
        const packageStep = findStep(job, target.packageStep);
        return componentRow({
          target: target.name === "Windows x64 unsigned Preview" ? "Windows x64 Preview" : target.name,
          mode: "rebuild",
          candidate: job,
          duration: jobDurationMs(job),
          detail: `${target.detail} ${formatDuration(stepDurationMs(packageStep))}`,
          url: job.html_url ?? payload.run.html_url,
        });
      });
    }

    const reuseJob = findJob(payload, "Reuse desktop release assets");
    if (reuseJob) {
      return [
        componentRow({
          target: "macOS arm64 + x64 + Windows x64",
          mode: "reuse",
          candidate: reuseJob,
          duration: jobDurationMs(reuseJob),
          detail: "copied previously verified assets",
          url: reuseJob.html_url ?? payload.run.html_url,
        }),
      ];
    }

    const planJob = findJob(payload, "Plan desktop release asset");
    return [
      componentRow({
        target: "macOS arm64 + x64 + Windows x64",
        mode: "already prepared",
        candidate: planJob ?? payload.run,
        duration: jobDurationMs(planJob) ?? runDurationMs(payload.run),
        detail: `requested ${requestedMode}; Draft assets were already ready`,
        url: planJob?.html_url ?? payload.run.html_url,
      }),
    ];
  }

  const buildJob = findJob(payload, "Build Android packages");
  if (buildJob) {
    const packageStep = findStep(
      buildJob,
      "Build signed release APK for GitHub Release",
    );
    return [
      componentRow({
        target: "Android arm64",
        mode: "rebuild",
        candidate: buildJob,
        duration: jobDurationMs(buildJob),
        detail: `APK build ${formatDuration(stepDurationMs(packageStep))}`,
        url: buildJob.html_url ?? payload.run.html_url,
      }),
    ];
  }

  const reuseJob = findJob(payload, "Reuse Android release APK");
  if (reuseJob) {
    return [
      componentRow({
        target: "Android arm64",
        mode: "reuse",
        candidate: reuseJob,
        duration: jobDurationMs(reuseJob),
        detail: "copied previously verified Play-signed APK",
        url: reuseJob.html_url ?? payload.run.html_url,
      }),
    ];
  }

  const planJob = findJob(payload, "Plan Android release asset");
  return [
    componentRow({
      target: "Android arm64",
      mode: "already prepared",
      candidate: planJob ?? payload.run,
      duration: jobDurationMs(planJob) ?? runDurationMs(payload.run),
      detail: `requested ${requestedMode}; Draft APK was already ready`,
      url: planJob?.html_url ?? payload.run.html_url,
    }),
  ];
}

export function createReleaseTimingReport({
  release,
  desktop,
  desktopMode,
  mobile,
  mobileMode,
  docker,
  store = null,
  cloudflare,
  tcrSource,
  tcrReadyAt,
  tcrStatus,
}) {
  const cloudflareJob = findJob(cloudflare, "Build and deploy Demo Worker");
  const cloudflareStep = findStep(cloudflareJob, "Deploy Demo Worker");
  const dockerJob = findJob(docker, "Publish official multi-platform image");
  const dockerStep = findStep(dockerJob, "Build and publish image");
  const storeJob = store ? findJob(store, "Deliver Google Play") : null;
  const storeBuildStep = findStep(
    storeJob,
    "Build and verify signed Play bundle",
  );
  const storeUploadStep = findStep(storeJob, "Upload bundle to Google Play");
  const tcrSourceJob = findJob(
    tcrSource,
    "Trigger asynchronous Tencent-side image build",
  );
  const tcrStart = tcrSource.run.run_started_at ?? tcrSource.run.created_at;
  const tcrDuration = durationMs(tcrStart, tcrReadyAt);

  const rows = [
    componentRow({
      target: "Cloudflare Demo Worker",
      mode: "deploy",
      candidate: cloudflareJob ?? cloudflare.run,
      duration: jobDurationMs(cloudflareJob) ?? runDurationMs(cloudflare.run),
      detail: `deploy step ${formatDuration(stepDurationMs(cloudflareStep))}`,
      url: cloudflareJob?.html_url ?? cloudflare.run.html_url,
    }),
    componentRow({
      target: "Docker GHCR (amd64 + arm64)",
      mode: "build + push",
      candidate: dockerJob ?? docker.run,
      duration: jobDurationMs(dockerJob) ?? runDurationMs(docker.run),
      detail: `image build/push ${formatDuration(stepDurationMs(dockerStep))}`,
      url: dockerJob?.html_url ?? docker.run.html_url,
    }),
    {
      target: "Docker TCR (amd64 + arm64)",
      mode: "Tencent-side build",
      result: tcrStatus,
      durationMs: tcrDuration,
      detail: `release source sync ${formatDuration(jobDurationMs(tcrSourceJob) ?? runDurationMs(tcrSource.run))}; duration is end-to-end until the public TCR tag was observed`,
      url: tcrSourceJob?.html_url ?? tcrSource.run.html_url,
    },
    ...nativeRows(desktop, "desktop", desktopMode),
    ...nativeRows(mobile, "android", mobileMode),
    ...(storeJob
      ? [
          componentRow({
            target: "Google Play signed APK",
            mode: "build + deliver",
            candidate: storeJob,
            duration: jobDurationMs(storeJob),
            detail: `AAB build ${formatDuration(stepDurationMs(storeBuildStep))}; Play upload ${formatDuration(stepDurationMs(storeUploadStep))}`,
            url: storeJob.html_url ?? store.run.html_url,
          }),
        ]
      : []),
  ];

  const publishedAt = timestamp(release.publishedAt);
  const endpointReadyTimes = [cloudflare.run.updated_at, tcrReadyAt]
    .map(timestamp)
    .filter((value) => value !== null);
  const allEndpointsReady =
    resultOf(cloudflareJob ?? cloudflare.run) === "success" &&
    tcrStatus === "success" &&
    endpointReadyTimes.length === 2;
  const allEndpointsReadyAt = allEndpointsReady
    ? Math.max(...endpointReadyTimes)
    : null;

  return {
    schemaVersion: 1,
    release,
    generatedAt: new Date().toISOString(),
    allEndpointsReady,
    allEndpointsReadyDurationMs:
      publishedAt !== null &&
      allEndpointsReadyAt !== null &&
      allEndpointsReadyAt >= publishedAt
        ? allEndpointsReadyAt - publishedAt
        : null,
    rows,
  };
}

export function renderReleaseTimingMarkdown(report) {
  const readinessSummary = report.allEndpointsReady
    ? `All post-publication endpoints were observed after **${formatDuration(report.allEndpointsReadyDurationMs)}**.`
    : "At least one post-publication endpoint failed or was not observed before the reporting deadline.";
  const lines = [
    `## Release build timings · ${report.release.tag}`,
    "",
    `${readinessSummary} Client and GHCR assets are prepared in the Draft phase and therefore report their actual preparation jobs rather than time after publication.`,
    "",
    "| Target | Mode | Result | Duration | Detail | Workflow |",
    "| --- | --- | --- | ---: | --- | --- |",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${escapeCell(row.target)} | ${escapeCell(row.mode)} | ${escapeCell(row.result)} | ${formatDuration(row.durationMs)} | ${escapeCell(row.detail)} | ${runLink(row.url)} |`,
    );
  }

  lines.push(
    "",
    "> Durations use GitHub Actions job/step timestamps. TCR is measured end-to-end from the release-triggered source sync until the matching public multi-architecture tag and Git revision become visible.",
    "",
  );
  return lines.join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "end"}`);
    }
    options[key.slice(2)] = value;
  }
  for (const required of [
    "tag",
    "sha",
    "published-at",
    "desktop",
    "desktop-mode",
    "mobile",
    "mobile-mode",
    "docker",
    "cloudflare",
    "tcr-source",
    "tcr-status",
    "json",
    "markdown",
  ]) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }
  return options;
}

if (import.meta.main) {
  const options = parseArguments(process.argv.slice(2));
  const report = createReleaseTimingReport({
    release: {
      tag: options.tag,
      sha: options.sha,
      publishedAt: options["published-at"],
      url: options["release-url"] ?? null,
    },
    desktop: readJson(options.desktop),
    desktopMode: options["desktop-mode"],
    mobile: readJson(options.mobile),
    mobileMode: options["mobile-mode"],
    docker: readJson(options.docker),
    store: options.store ? readJson(options.store) : null,
    cloudflare: readJson(options.cloudflare),
    tcrSource: readJson(options["tcr-source"]),
    tcrReadyAt: options["tcr-ready-at"] || null,
    tcrStatus: options["tcr-status"],
  });
  writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(options.markdown, renderReleaseTimingMarkdown(report));
}
