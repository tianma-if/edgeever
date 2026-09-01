import { describe, expect, test } from "bun:test";
import {
  createReleaseTimingReport,
  renderReleaseTimingMarkdown,
  summarizeReleaseAttempts,
} from "./report-release-timings.mjs";

const step = (name, start, seconds) => ({
  name,
  conclusion: "success",
  started_at: start,
  completed_at: new Date(Date.parse(start) + seconds * 1000).toISOString(),
});

const job = (name, start, seconds, steps = []) => ({
  name,
  conclusion: "success",
  started_at: start,
  completed_at: new Date(Date.parse(start) + seconds * 1000).toISOString(),
  html_url: `https://example.test/jobs/${encodeURIComponent(name)}`,
  steps,
});

const payload = (name, start, seconds, jobs) => ({
  run: {
    name,
    conclusion: "success",
    created_at: start,
    run_started_at: start,
    updated_at: new Date(Date.parse(start) + seconds * 1000).toISOString(),
    html_url: `https://example.test/runs/${encodeURIComponent(name)}`,
  },
  jobs,
});

describe("release timing report", () => {
  test("combines Cloudflare, both registries, and rebuilt clients", () => {
    const start = "2026-08-25T00:00:00Z";
    const report = createReleaseTimingReport({
      release: { tag: "v1.41.0", sha: "abc", publishedAt: start },
      desktop: payload("Desktop", start, 600, [
        job("macOS arm64", start, 480, [
          step("Package desktop installer", start, 180),
        ]),
        job("macOS x64", start, 600, [
          step("Package desktop installer", start, 300),
        ]),
        job("Windows x64 unsigned Preview", start, 420, [
          step("Package unsigned Windows installer", start, 240),
        ]),
      ]),
      desktopMode: "rebuild",
      mobile: payload("Mobile", start, 540, [
        job("Build Android packages", start, 540, [
          step("Build signed release APK for GitHub Release", start, 420),
        ]),
      ]),
      mobileMode: "rebuild",
      docker: payload("Docker", start, 300, [
        job("Publish official multi-platform image", start, 300, [
          step("Build and publish image", start, 240),
        ]),
      ]),
      store: payload("Store", start, 660, [
        job("Deliver Google Play", start, 660, [
          step("Build and verify signed Play bundle", start, 180),
          step("Upload bundle to Google Play", start, 240),
        ]),
      ]),
      cloudflare: payload("Cloudflare", start, 120, [
        job("Build and deploy Demo Worker", start, 120, [
          step("Deploy Demo Worker", start, 60),
        ]),
      ]),
      tcrSource: payload("TCR", start, 20, [
        job("Trigger asynchronous Tencent-side image build", start, 20),
      ]),
      tcrReadyAt: "2026-08-25T00:10:00Z",
      tcrStatus: "success",
    });

    expect(report.allEndpointsReady).toBe(true);
    expect(report.allEndpointsReadyDurationMs).toBe(600_000);
    expect(report.rows.map((row) => row.target)).toEqual([
      "Cloudflare Demo Worker",
      "Docker GHCR (amd64 + arm64)",
      "Docker TCR (amd64 + arm64)",
      "macOS arm64",
      "macOS x64",
      "Windows x64 Preview",
      "Android arm64",
      "Google Play signed APK",
    ]);
    const markdown = renderReleaseTimingMarkdown(report);
    expect(markdown).toContain(
      "All post-publication endpoints were observed after **10m 00s**",
    );
    expect(markdown).toContain(
      "| Docker TCR (amd64 + arm64) | Tencent-side build | success | 10m 00s |",
    );
    expect(markdown).toContain(
      "| macOS x64 | rebuild | success | 10m 00s | package + notarize 5m 00s |",
    );
    expect(markdown).toContain(
      "| Windows x64 Preview | rebuild | success | 7m 00s | package 4m 00s |",
    );
    expect(markdown).toContain(
      "| Google Play signed APK | build + deliver | success | 11m 00s | AAB build 3m 00s; Play upload 4m 00s |",
    );
  });

  test("reports reused native assets without pretending they were rebuilt", () => {
    const start = "2026-08-25T00:00:00Z";
    const common = {
      release: { tag: "v1.41.1", sha: "def", publishedAt: start },
      docker: payload("Docker", start, 60, [
        job("Publish official multi-platform image", start, 60),
      ]),
      cloudflare: payload("Cloudflare", start, 60, [
        job("Build and deploy Demo Worker", start, 60),
      ]),
      tcrSource: payload("TCR", start, 15, [
        job("Trigger asynchronous Tencent-side image build", start, 15),
      ]),
      tcrReadyAt: "2026-08-25T00:02:00Z",
      tcrStatus: "success",
    };
    const report = createReleaseTimingReport({
      ...common,
      desktop: payload("Desktop", start, 40, [
        job("Reuse desktop release assets", start, 40),
      ]),
      desktopMode: "reuse",
      mobile: payload("Mobile", start, 30, [
        job("Reuse Android release APK", start, 30),
      ]),
      mobileMode: "reuse",
    });

    expect(report.rows.at(-2)).toMatchObject({
      target: "macOS arm64 + x64 + Windows x64",
      mode: "reuse",
      durationMs: 40_000,
    });
    expect(report.rows.at(-1)).toMatchObject({
      target: "Android arm64",
      mode: "reuse",
      durationMs: 30_000,
    });
  });

  test("does not claim all endpoints are ready when TCR times out", () => {
    const start = "2026-08-25T00:00:00Z";
    const report = createReleaseTimingReport({
      release: { tag: "v1.41.2", sha: "ghi", publishedAt: start },
      desktop: payload("Desktop", start, 40, [
        job("Reuse desktop release assets", start, 40),
      ]),
      desktopMode: "reuse",
      mobile: payload("Mobile", start, 30, [
        job("Reuse Android release APK", start, 30),
      ]),
      mobileMode: "reuse",
      docker: payload("Docker", start, 60, [
        job("Publish official multi-platform image", start, 60),
      ]),
      cloudflare: payload("Cloudflare", start, 60, [
        job("Build and deploy Demo Worker", start, 60),
      ]),
      tcrSource: payload("TCR", start, 15, [
        job("Trigger asynchronous Tencent-side image build", start, 15),
      ]),
      tcrReadyAt: null,
      tcrStatus: "timeout",
    });

    expect(report.allEndpointsReady).toBe(false);
    expect(report.allEndpointsReadyDurationMs).toBeNull();
    expect(renderReleaseTimingMarkdown(report)).toContain(
      "At least one post-publication endpoint failed or was not observed",
    );
  });

  test("reports every Draft attempt and distinguishes Play APK recovery", () => {
    const start = "2026-08-25T00:00:00Z";
    const attempts = [
      payload("Desktop failed", start, 420, []),
      payload("Desktop retry", "2026-08-25T00:07:30Z", 360, []),
    ];
    Object.assign(attempts[0].run, { id: 1, head_sha: "old", conclusion: "failure" });
    Object.assign(attempts[1].run, { id: 2, head_sha: "new", conclusion: "success" });
    expect(summarizeReleaseAttempts(attempts)).toEqual({
      workflowRunCount: 2,
      releaseTargetCount: 2,
      failedRunCount: 1,
      endToEndDurationMs: 810_000,
      cumulativeWorkflowDurationMs: 780_000,
    });

    const common = {
      release: { tag: "v1.41.3", sha: "new", publishedAt: start },
      desktop: payload("Desktop", start, 40, [job("Plan desktop release asset", start, 40)]),
      desktopMode: "rebuild",
      mobile: payload("Mobile", start, 30, [job("Plan Android release asset", start, 30)]),
      mobileMode: "rebuild",
      docker: payload("Docker", start, 60, [job("Publish official multi-platform image", start, 60)]),
      store: payload("Store recovery", start, 120, [
        job("Deliver Google Play", start, 120, [
          step("Download Play-signed universal APK", start, 45),
        ]),
      ]),
      storeMode: "recover",
      attempts,
      cloudflare: payload("Cloudflare", start, 60, [job("Build and deploy Demo Worker", start, 60)]),
      tcrSource: payload("TCR", start, 15, [job("Trigger asynchronous Tencent-side image build", start, 15)]),
      tcrReadyAt: "2026-08-25T00:02:00Z",
      tcrStatus: "success",
    };
    const report = createReleaseTimingReport(common);
    expect(report.rows.at(-1)).toMatchObject({
      target: "Google Play signed APK",
      mode: "recover",
      detail: "recovered existing Play-signed APK 45s",
    });
    const markdown = renderReleaseTimingMarkdown(report);
    expect(markdown).toContain("across **2 workflow runs** and **2 release target(s)**");
    expect(markdown).toContain("1 run(s) failed or were cancelled");
  });
});
