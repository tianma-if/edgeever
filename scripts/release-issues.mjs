/** Every change must explicitly declare resolved issues, or opt out with `none`. */
export const parseChangeIssues = (values, changeCount) => {
  if (values.length !== changeCount) {
    throw new Error('Each change requires --change-issue "<number>:en|zh,..." or --change-issue none.');
  }
  const issues = new Map();
  for (const value of values) {
    if (value === "none") continue;
    for (const entry of value.split(",")) {
      const match = entry.trim().match(/^([1-9]\d*):(en|zh)$/);
      if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new Error(`Invalid --change-issue: ${entry}; use <number>:en|zh or none.`);
      }
      const number = Number(match[1]);
      const language = match[2];
      if (issues.has(number) && issues.get(number).language !== language) {
        throw new Error(`Conflicting comment languages for Issue #${number}.`);
      }
      issues.set(number, { number, language });
    }
  }
  return [...issues.values()].sort((a, b) => a.number - b.number);
};

export const validateResolvedIssues = (issues, getIssue) => {
  for (const { number } of issues) {
    const issue = getIssue(number);
    if (issue.number !== number || issue.pull_request) {
      throw new Error(`#${number} must be an Issue in the release repository, not a PR.`);
    }
  }
};

export const issueReleaseComment = ({ tag, url, language }) => {
  const marker = `<!-- edgeever-release-issue:${tag} -->`;
  return `${marker}\n${language === "zh"
    ? `本问题已在 [${tag}](${url}) 发布，发布后的必要审计已通过。`
    : `Released in [${tag}](${url}). Required post-publication audits passed.`}`;
};

/** A durable successful-audit receipt is required, including on a retry. */
export const finishResolvedIssues = ({ release, auditedSha, issues, client }) => {
  if (release.isDraft || release.isPrerelease || !auditedSha || auditedSha !== release.targetCommitish) {
    throw new Error("Issue completion requires a published stable Release with successful audits for its target commit.");
  }
  validateResolvedIssues(issues, client.getIssue);
  const failures = [];
  for (const issue of issues) {
    try {
      const body = issueReleaseComment({ tag: release.tagName, url: release.url, language: issue.language });
      // Read all pages: a retry must not duplicate a backlink on a long discussion.
      if (!client.listComments(issue.number).some((comment) => comment.body === body)) {
        client.comment(issue.number, body);
      }
      // Never close without a successful backlink; preserve already-closed reasons.
      if (client.getIssue(issue.number).state === "open") client.close(issue.number);
    } catch (error) {
      failures.push(`#${issue.number}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Issue follow-up failed (${failures.join("; ")}). Retry: bun run release -- --finish-issues ${release.tagName}`);
  }
};
