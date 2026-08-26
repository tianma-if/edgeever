import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  auditReleaseCommitCoverage,
  buildIssueBody,
  buildReleaseNotes,
  buildReleaseSummary,
  buildReleaseTitle,
  draftRunResumeAction,
  nextVersion,
  parseReleaseCheckpoint,
  parseReleaseArgs,
  playDeliveryFailureStrategy,
  RELEASE_WORKFLOWS,
  RELEASE_VALIDATIONS,
  resolveReleaseVersion,
  reusedAssetMatches,
  selectPublishedDmg,
  waitForRun,
} from "./release.mjs";

describe("release automation", () => {
  test("prepares and audits the official Docker image with every formal release", () => {
    expect(RELEASE_WORKFLOWS.docker).toBe("docker-image.yml");
  });

  test("dispatches a unified post-release endpoint timing report", () => {
    expect(RELEASE_WORKFLOWS.timings).toBe("release-timings.yml");
    const releaseSource = readFileSync(new URL("./release.mjs", import.meta.url), "utf8");
    expect(releaseSource).toContain("desktop_run_id=\${desktopRunId}");
    expect(releaseSource).toContain("mobile_run_id=\${mobileRunId}");
    expect(releaseSource).toContain("docker_run_id=\${dockerRunId}");
    expect(releaseSource).toContain("store_run_id=\${checkpoint.storeRunId}");
    expect(releaseSource).toContain("endpoint timing report continues in background");
  });

  test("blocks publication until the Draft Android APK passes the Play signature gate", () => {
    const releaseSource = readFileSync(new URL("./release.mjs", import.meta.url), "utf8");
    const signatureGate = releaseSource.indexOf('label: "Draft Android Play signature gate"');
    const publication = releaseSource.indexOf('"--draft=false"');

    expect(RELEASE_WORKFLOWS.androidPlaySignature).toBe("android-play-signature-audit.yml");
    expect(signatureGate).toBeGreaterThanOrEqual(0);
    expect(publication).toBeGreaterThan(signatureGate);
  });

  test("starts Play delivery as soon as Android preparation finishes", () => {
    const releaseSource = readFileSync(new URL("./release.mjs", import.meta.url), "utf8");
    const androidReady = releaseSource.lastIndexOf("const androidReleaseReady");
    const mobileWait = releaseSource.indexOf('label: "Draft Android assets"', androidReady);
    const playDelivery = releaseSource.indexOf("await ensurePlayDelivery", androidReady);
    const allDraftGates = releaseSource.indexOf("await Promise.all", androidReady);

    expect(RELEASE_WORKFLOWS.storeDelivery).toBe("store-delivery.yml");
    expect(mobileWait).toBeGreaterThan(androidReady);
    expect(playDelivery).toBeGreaterThan(mobileWait);
    expect(playDelivery).toBeLessThan(allDraftGates);
  });

  test("restores an exact Draft checkpoint without exposing it in Issue text", () => {
    const checkpoint = { releaseSha: "abc", desktopRunId: 123 };
    const body = `<!-- edgeever-release-checkpoint:v1.42.0\n${JSON.stringify(checkpoint)}\n-->`;
    expect(parseReleaseCheckpoint(body, "v1.42.0")).toEqual(checkpoint);
    expect(parseReleaseCheckpoint(body, "v1.42.1")).toBeNull();
    expect(parseReleaseCheckpoint("malformed", "v1.42.0")).toBeNull();
  });

  test("reuses successful Draft runs and reruns only failed ones", () => {
    const headSha = "abc";
    expect(draftRunResumeAction({
      runId: 1,
      runView: { headSha, status: "completed", conclusion: "success" },
      headSha,
    })).toBe("reuse");
    expect(draftRunResumeAction({
      runId: 2,
      runView: { headSha, status: "completed", conclusion: "failure" },
      headSha,
    })).toBe("rerun");
    expect(draftRunResumeAction({
      runId: 3,
      runView: { headSha: "different", status: "completed", conclusion: "success" },
      headSha,
    })).toBe("dispatch");
  });

  test("only retries a Play delivery when upload definitely did not start", () => {
    const run = (conclusion) => ({
      jobs: [{
        name: "Deliver Google Play",
        steps: [{ name: "Upload bundle to Google Play", conclusion }],
      }],
    });
    expect(playDeliveryFailureStrategy(run("skipped"))).toBe("rerun");
    expect(playDeliveryFailureStrategy(run("success"))).toBe("recover");
    expect(playDeliveryFailureStrategy(run("failure"))).toBe("recover");
  });

  test("runs the complete project regression suite before release", () => {
    expect(RELEASE_VALIDATIONS).toContainEqual({
      label: "Project regression tests",
      args: ["run", "test"],
    });
  });

  test("retries transient GitHub status failures while waiting for a workflow", async () => {
    let attempts = 0;
    let polls = 0;
    const result = await waitForRun({
      repository: "tianma-if/edgeever",
      runId: 123,
      label: "Draft assets",
      viewRun: () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient EOF");
        return { status: "completed", conclusion: "success", url: "https://example.test/run" };
      },
      waitForNextPoll: async () => {
        polls += 1;
      },
    });

    expect(result.conclusion).toBe("success");
    expect(attempts).toBe(3);
    expect(polls).toBe(2);
  });

  test("parses paired bilingual changes and labels", () => {
    expect(
      parseReleaseArgs([
        "--issue-title",
        "Improve release flow",
        "--bump",
        "minor",
        "--label",
        "enhancement",
        "--change-en",
        "Run checks in parallel.",
        "--change-zh",
        "并行运行检查。",
        "--change-locale",
        "ja-JP:チェックを並列実行します。",
        "--change-commit",
        "abc1234",
      ]),
    ).toMatchObject({
      issueTitle: "Improve release flow",
      bump: "minor",
      labels: ["enhancement"],
      changesEn: ["Run checks in parallel."],
      changesZh: ["并行运行检查。"],
      localizedChanges: { "ja-JP": ["チェックを並列実行します。"] },
      changeCommits: ["abc1234"],
    });
  });

  test("keeps post-release desktop installation explicitly opt-in", () => {
    expect(parseReleaseArgs([
      "--issue-title", "Release",
      "--bump", "patch",
      "--label", "maintenance",
      "--change-en", "Update the release flow.",
      "--change-zh", "更新发布流程。",
      "--change-commit", "abc1234",
    ])).toMatchObject({ installDesktop: false });
    expect(parseReleaseArgs([
      "--issue-title", "Release",
      "--bump", "patch",
      "--label", "maintenance",
      "--change-en", "Update the release flow.",
      "--change-zh", "更新发布流程。",
      "--change-commit", "abc1234",
      "--install-desktop",
    ])).toMatchObject({ installDesktop: true });
  });

  test("rejects mismatched bilingual changes", () => {
    expect(() =>
      parseReleaseArgs([
        "--issue-title",
        "Broken input",
        "--bump",
        "patch",
        "--label",
        "bug",
        "--change-en",
        "Only English.",
      ])
    ).toThrow("--change-en and --change-zh");
  });

  test("increments stable semantic versions", () => {
    expect(nextVersion("1.6.50", "patch")).toBe("1.6.51");
    expect(nextVersion("1.6.50", "minor")).toBe("1.7.0");
    expect(nextVersion("1.6.50", "major")).toBe("2.0.0");
    expect(() => nextVersion("1.6", "patch")).toThrow("stable X.Y.Z");
    expect(() => nextVersion("1.6.50", "automatic")).toThrow("patch, minor, or major");
  });

  test("resumes a Draft only when it matches the requested version and HEAD", () => {
    const draftCandidate = {
      tagName: "v1.17.1",
      isDraft: true,
      isPrerelease: false,
      targetCommitish: "current-head",
    };
    expect(resolveReleaseVersion({
      previousVersion: "1.17.0",
      packageVersion: "1.17.1",
      bump: "patch",
      headSha: "current-head",
      draftCandidate,
    })).toMatchObject({
      releaseVersion: "1.17.1",
      releaseBaseTag: "v1.17.0",
      resumedDraft: draftCandidate,
      withdrawnDraft: null,
    });
  });

  test("reserves a withdrawn Draft version and keeps the published audit baseline", () => {
    const draftCandidate = {
      tagName: "v1.17.1",
      isDraft: true,
      isPrerelease: false,
      targetCommitish: "withdrawn-release",
    };
    expect(resolveReleaseVersion({
      previousVersion: "1.17.0",
      packageVersion: "1.17.1",
      bump: "patch",
      headSha: "current-head",
      draftCandidate,
      draftTargetIsAncestor: true,
    })).toMatchObject({
      releaseVersion: "1.17.2",
      releaseBaseTag: "v1.17.0",
      resumedDraft: null,
      withdrawnDraft: draftCandidate,
    });
  });

  test("rejects a Draft from unrelated history", () => {
    expect(() => resolveReleaseVersion({
      previousVersion: "1.17.0",
      packageVersion: "1.17.1",
      bump: "patch",
      headSha: "current-head",
      draftCandidate: {
        tagName: "v1.17.1",
        isDraft: true,
        isPrerelease: false,
        targetCommitish: "unrelated-head",
      },
      draftTargetIsAncestor: false,
    })).toThrow("current HEAD or its history");
  });

  test("uses the stable tag as the GitHub Release title", () => {
    expect(buildReleaseTitle("v1.6.55")).toBe("v1.6.55");
    expect(() => buildReleaseTitle("1.6.55")).toThrow("stable vX.Y.Z tag");
  });

  test("requires an explicit version bump", () => {
    expect(() =>
      parseReleaseArgs([
        "--issue-title",
        "Missing bump",
        "--label",
        "bug",
        "--change-en",
        "Fix a bug.",
        "--change-zh",
        "修复问题。",
        "--change-commit",
        "abc1234",
      ])
    ).toThrow("--bump must be patch, minor, or major");
  });

  test("builds concise user-facing bilingual release notes", () => {
    const notes = buildReleaseNotes({
      changesEn: ["Improve the release flow."],
      changesZh: ["优化发布流程。"],
      issueNumber: 126,
    });
    expect(notes).toContain("## Key Changes");
    expect(notes).toContain("Related Issue: #126");
    expect(notes).toContain("## 🇨🇳 中文说明 / Chinese Changelog");
    expect(notes).toContain("关联 Issue：#126");
    expect(notes.indexOf("## 🇨🇳 中文说明 / Chinese Changelog"))
      .toBeLessThan(notes.indexOf("## Key Changes"));
    expect(notes.indexOf("优化发布流程。"))
      .toBeLessThan(notes.indexOf("Improve the release flow."));
    expect(notes).not.toContain("## Verification");
    expect(notes).not.toContain("## 验证");
    expect(notes).not.toContain("bun run");
    expect(notes).not.toContain("Version bump");
    expect(notes).not.toContain("release plan");
    expect(notes).not.toContain("\\n");
  });

  test("builds the in-app summary from the same bilingual release changes", () => {
    expect(buildReleaseSummary({
      version: "1.6.55",
      changesEn: ["Improve the release flow."],
      changesZh: ["优化发布流程。"],
      localizedChanges: { "ja-JP": ["リリースフローを改善します。"] },
    })).toEqual({
      version: "1.6.55",
      changes: {
        "en-US": ["Improve the release flow."],
        "zh-CN": ["优化发布流程。"],
        "ja-JP": ["リリースフローを改善します。"],
      },
    });
  });

  test("builds a bilingual umbrella Issue", () => {
    const body = buildIssueBody({
      changesEn: ["Parallel checks."],
      changesZh: ["并行检查。"],
      commitCoverageAudit: {
        mappings: [{
          changeIndex: 0,
          commits: [{ sha: "aaaaaaaa11111111111111111111111111111111" }],
        }],
        ignored: [{
          commit: { sha: "bbbbbbbb22222222222222222222222222222222" },
          reason: "test-only coverage",
        }],
      },
    });
    expect(body).toContain("## Summary");
    expect(body).toContain("- Parallel checks.");
    expect(body).toContain("## 中文说明");
    expect(body).toContain("- 并行检查。");
    expect(body).toContain("## Commit coverage audit");
    expect(body).toContain("Play-signed Android arm64 APK");
    expect(body).toContain("- Change 1: `aaaaaaaa`");
    expect(body).toContain("- Excluded `bbbbbbbb`: test-only coverage");
  });

  test("requires every bilingual change to map to commits", () => {
    expect(() =>
      parseReleaseArgs([
        "--issue-title",
        "Missing commit mapping",
        "--bump",
        "patch",
        "--label",
        "bug",
        "--change-en",
        "Fix a bug.",
        "--change-zh",
        "修复问题。",
      ])
    ).toThrow("--change-commit");
  });

  test("audits complete commit coverage across changes and explicit ignores", () => {
    const commits = [
      { sha: "aaaaaaaa11111111111111111111111111111111", subject: "feat: add resource actions" },
      { sha: "bbbbbbbb22222222222222222222222222222222", subject: "test: cover resource actions" },
      { sha: "cccccccc33333333333333333333333333333333", subject: "fix: stabilize editor" },
    ];
    const audit = auditReleaseCommitCoverage({
      commits,
      changeCommits: ["aaaaaaaa,cccccccc"],
      ignoredCommits: ["bbbbbbbb:test-only coverage"],
    });
    expect(audit.mappings[0].commits.map((commit) => commit.sha)).toEqual([
      commits[0].sha,
      commits[2].sha,
    ]);
    expect(audit.ignored).toEqual([{ commit: commits[1], reason: "test-only coverage" }]);
  });

  test("blocks a release when a commit is missing from the notes audit", () => {
    const commits = [
      { sha: "aaaaaaaa11111111111111111111111111111111", subject: "feat: documented" },
      { sha: "bbbbbbbb22222222222222222222222222222222", subject: "fix: accidentally omitted" },
    ];
    expect(() => auditReleaseCommitCoverage({
      commits,
      changeCommits: ["aaaaaaaa"],
      ignoredCommits: [],
    })).toThrow("bbbbbbbb fix: accidentally omitted");
  });

  test("requires valid ignore reasons and rejects covered commits as ignored", () => {
    const commits = [
      { sha: "aaaaaaaa11111111111111111111111111111111", subject: "feat: documented" },
    ];
    expect(() => auditReleaseCommitCoverage({
      commits,
      changeCommits: ["aaaaaaaa"],
      ignoredCommits: ["aaaaaaaa:no public impact"],
    })).toThrow("both covered and ignored");
    expect(() => auditReleaseCommitCoverage({
      commits,
      changeCommits: [],
      ignoredCommits: ["aaaaaaaa"],
    })).toThrow("<commit-sha>:<reason>");
  });

  test("automatically accounts for a resumable release version commit", () => {
    const releaseCommit = {
      sha: "dddddddd44444444444444444444444444444444",
      subject: "chore: release v1.10.3 [skip ci]",
    };
    const audit = auditReleaseCommitCoverage({
      commits: [releaseCommit],
      changeCommits: [],
      ignoredCommits: [],
    });
    expect(audit.ignored).toEqual([{ commit: releaseCommit, reason: "release automation commit" }]);
  });

  test("requires reused assets to keep name, size, and digest", () => {
    const previous = [{ name: "app.apk", size: 10, digest: "sha256:abc" }];
    expect(reusedAssetMatches(previous, [...previous], "app.apk")).toBe(true);
    expect(
      reusedAssetMatches(previous, [{ ...previous[0], digest: "sha256:def" }], "app.apk"),
    ).toBe(false);
  });

  test("selects the DMG matching the current Mac architecture", () => {
    const assets = [
      {
        name: "EdgeEver-1.6.51-mac-arm64.dmg",
        size: 10,
        digest: "sha256:abc",
      },
      {
        name: "EdgeEver-1.6.51-mac-x64.dmg",
        size: 11,
        digest: "sha256:def",
      },
    ];
    expect(
      selectPublishedDmg(assets, "arm64"),
    ).toMatchObject({
      asset: { name: "EdgeEver-1.6.51-mac-arm64.dmg" },
      version: "1.6.51",
    });
    expect(selectPublishedDmg(assets, "x64")).toMatchObject({
      asset: { name: "EdgeEver-1.6.51-mac-x64.dmg" },
      version: "1.6.51",
    });
  });
});
