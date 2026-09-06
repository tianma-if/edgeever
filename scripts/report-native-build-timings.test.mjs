import { describe, expect, test } from "bun:test";
import {
  createTimingReport,
  durationMs,
  formatDuration,
  renderTimingMarkdown,
} from "./report-native-build-timings.mjs";

function job(name, startedAt, completedAt, packageDurationSeconds) {
  const packageStart = new Date(Date.parse(startedAt) + 60_000).toISOString();
  const packageEnd = new Date(Date.parse(packageStart) + packageDurationSeconds * 1000).toISOString();
  return {
    name,
    conclusion: "success",
    started_at: startedAt,
    completed_at: completedAt,
    steps: [
      {
        name: "Install dependencies",
        conclusion: "success",
        started_at: startedAt,
        completed_at: packageStart,
      },
      {
        name: name.startsWith("macOS")
          ? "Package desktop installer"
          : name.startsWith("Windows")
            ? "Package unsigned Windows installer"
            : "Build signed release APK for GitHub Release",
        conclusion: "success",
        started_at: packageStart,
        completed_at: packageEnd,
      },
    ],
  };
}

describe("native build timing reports", () => {
  test("calculates stable durations", () => {
    expect(durationMs("2026-08-13T00:00:00Z", "2026-08-13T00:02:03Z")).toBe(123_000);
    expect(durationMs(null, "2026-08-13T00:02:03Z")).toBeNull();
    expect(formatDuration(123_000)).toBe("2m 03s");
  });

  test("reports both macOS architectures and Windows x64 from Actions timestamps", () => {
    const report = createTimingReport({
      jobs: [
        job("macOS arm64", "2026-08-13T00:00:00Z", "2026-08-13T00:06:00Z", 180),
        job("macOS x64", "2026-08-13T00:00:00Z", "2026-08-13T00:09:00Z", 360),
        job("Windows x64 unsigned Preview", "2026-08-13T00:00:00Z", "2026-08-13T00:07:00Z", 240),
      ],
    }, "desktop", { runId: "123" });

    expect(report.runId).toBe("123");
    expect(report.targets.map((target) => target.name)).toEqual([
      "macOS arm64",
      "macOS x64",
      "Windows x64 Preview",
    ]);
    expect(report.targets[1].packageDurationMs).toBe(360_000);
    expect(renderTimingMarkdown(report)).toContain("| macOS x64 | success | 9m 00s | 1m 00s | 6m 00s | 2m 00s |");
    expect(renderTimingMarkdown(report)).toContain("| Windows x64 Preview | success | 7m 00s | 1m 00s | 4m 00s | 2m 00s |");
  });

  test("selects the release Android package step", () => {
    const report = createTimingReport({
      jobs: [job("Build Android packages", "2026-08-13T00:00:00Z", "2026-08-13T00:10:00Z", 480)],
    }, "android");
    expect(report.targets[0]).toMatchObject({
      name: "Android arm64",
      packageStep: "Build signed release APK for GitHub Release",
      packageDurationMs: 480_000,
    });
  });

  test("selects the completed Android package variant", () => {
    const androidJob = job("Build Android packages", "2026-08-13T00:00:00Z", "2026-08-13T00:10:00Z", 480);
    androidJob.steps.unshift({
      name: "Build signed release APK for GitHub Release",
      conclusion: "skipped",
      started_at: null,
      completed_at: null,
    });
    androidJob.steps[2].name = "Build fast main-branch APK";
    const report = createTimingReport({ jobs: [androidJob] }, "android");
    expect(report.targets[0].packageStep).toBe("Build fast main-branch APK");
  });
});
