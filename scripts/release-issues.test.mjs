import { describe, expect, test } from "bun:test";
import { parseReleaseArgs } from "./release.mjs";
import { parseChangeIssues, finishResolvedIssues, validateResolvedIssues } from "./release-issues.mjs";

const release = { tagName: "v2.19.0", url: "https://github.com/tianma-if/edgeever/releases/tag/v2.19.0", targetCommitish: "abc123", isDraft: false, isPrerelease: false };
const issues = [{ number: 767, language: "en" }, { number: 751, language: "zh" }];
const fixture = () => {
  const records = new Map(issues.map(({ number }) => [number, { number, state: "open", comments: [] }]));
  const calls = [];
  const client = {
    getIssue: (number) => records.get(number),
    listComments: (number) => records.get(number).comments,
    comment: (number, body) => { calls.push(["comment", number]); records.get(number).comments.push({ body }); },
    close: (number) => { calls.push(["close", number]); records.get(number).state = "closed"; },
  };
  return { records, calls, client };
};
const finish = (f, overrides = {}) => finishResolvedIssues({ release, auditedSha: "abc123", issues, client: f.client, ...overrides });

describe("release Issue follow-up", () => {
  test("requires an explicit per-change declaration and rejects PRs and conflicting languages", () => {
    expect(() => parseChangeIssues([], 1)).toThrow("Each change requires");
    expect(parseChangeIssues(["767:en,751:zh", "767:en", "none"], 3)).toEqual([issues[1], issues[0]]);
    for (const value of ["0:en", "-1:en", "767", "767:fr", "other/repo#767:en", "none,767:en", "9007199254740992:en"]) {
      expect(() => parseChangeIssues([value], 1)).toThrow("Invalid");
    }
    expect(() => parseChangeIssues(["767:en,767:zh"], 1)).toThrow("Conflicting");
    expect(() => validateResolvedIssues(issues, (number) => ({ number, pull_request: {} }))).toThrow("not a PR");
  });

  test("CLI cannot omit Issue decisions, and supports a separate published-release retry", () => {
    const args = ["--bump", "patch", "--issue-title", "Fix", "--label", "bug", "--change-en", "Fix PDF", "--change-zh", "修复 PDF", "--change-locale", "ja:PDF を修正", "--change-commit", "abc1234"];
    expect(() => parseReleaseArgs(args)).toThrow("--change-issue");
    expect(parseReleaseArgs([...args, "--change-issue", "767:en"]).resolvedIssues).toEqual([issues[0]]);
    expect(parseReleaseArgs(["--finish-issues", "v2.19.0"])).toMatchObject({ finishIssues: "v2.19.0" });
    expect(() => parseReleaseArgs(["--finish-issues", "v2.19.0", "--bump", "patch"])).toThrow("only accepts");
    expect(() => parseReleaseArgs(["--finish-issues", "latest"])).toThrow("stable");
  });

  test("never mutates Issues for Drafts, prereleases, failed or stale audit receipts", () => {
    for (const overrides of [{ release: { ...release, isDraft: true } }, { release: { ...release, isPrerelease: true } }, { auditedSha: undefined }, { auditedSha: "old" }]) {
      const f = fixture();
      expect(() => finish(f, overrides)).toThrow("successful audits");
      expect(f.calls).toEqual([]);
    }
  });

  test("backlinks in the selected language before closing, without touching unrelated Issues", () => {
    const f = fixture();
    finish(f);
    expect(f.calls).toEqual([["comment", 767], ["close", 767], ["comment", 751], ["close", 751]]);
    expect(f.records.get(767).comments[0].body).toContain(`Released in [v2.19.0](${release.url})`);
    expect(f.records.get(751).comments[0].body).toContain(`本问题已在 [v2.19.0](${release.url}) 发布`);
    finish(f);
    expect(f.calls).toHaveLength(4);
  });

  test("a comment failure keeps its Issue open, finishes other Issues, and can be retried", () => {
    const f = fixture();
    const comment = f.client.comment;
    f.client.comment = (number, body) => { if (number === 767) throw new Error("network"); comment(number, body); };
    expect(() => finish(f)).toThrow("--finish-issues v2.19.0");
    expect(f.records.get(767).state).toBe("open");
    expect(f.records.get(751).state).toBe("closed");
    f.client.comment = comment;
    finish(f);
    expect(f.records.get(767).state).toBe("closed");
    expect(f.records.get(751).comments).toHaveLength(1);
  });

  test("retry after a close failure reuses the backlink and preserves already-closed reasons", () => {
    const f = fixture();
    const close = f.client.close;
    f.client.close = () => { throw new Error("network"); };
    expect(() => finish(f)).toThrow("--finish-issues");
    f.client.close = close;
    f.records.get(751).state = "closed";
    f.records.get(751).state_reason = "not_planned";
    finish(f);
    expect(f.records.get(767).comments).toHaveLength(1);
    expect(f.records.get(751).state_reason).toBe("not_planned");
    expect(f.calls.filter(([action]) => action === "close")).toEqual([["close", 767]]);
  });
});
