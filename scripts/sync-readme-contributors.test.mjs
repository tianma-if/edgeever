import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRIBUTORS_END_MARKER,
  CONTRIBUTORS_START_MARKER,
  README_CONTRIBUTOR_SECTIONS,
  circularAvatarUrl,
  fetchRepositoryContributors,
  mergeContributorSources,
  syncReadmeContributors,
  upsertReadmeContributorsSection,
} from "./sync-readme-contributors.mjs";

describe("README contributors wall sync", () => {
  test("merges direct contributors, co-authored stats, recent commits, and explicit release contributors without bots", () => {
    const merged = mergeContributorSources({
      ownerLogin: "tianma-if",
      directContributors: [
        { login: "sivdead", id: 27731043, contributions: 14, type: "User" },
        { login: "tianma-if", id: 5895871, contributions: 2728, type: "User" },
        { login: "dependabot[bot]", id: 49699333, contributions: 10, type: "Bot" },
      ],
      statsContributors: [
        {
          total: 1,
          author: { login: "Crowszzz", id: 75199133 },
        },
      ],
      recentCommits: [
        {
          author: { login: "Sergmay911", id: 304439776 },
          committer: { login: "web-flow", id: 19864447 },
        },
      ],
      extraUsers: [{ login: "new-contrib", id: 999999 }],
    });

    expect(merged.map((item) => item.login)).toEqual([
      "tianma-if",
      "sivdead",
      "Crowszzz",
      "Sergmay911",
      "new-contrib",
    ]);
  });

  test("fetches explicit --contributor users that have not entered GitHub contributor caches yet", () => {
    const calls = [];
    const contributors = fetchRepositoryContributors({
      repository: "tianma-if/edgeever",
      extraLogins: ["@fresh-user", "tianma-if"],
      ghJson: (args) => {
        calls.push(args.join(" "));
        const endpoint = args[1];
        if (endpoint.endsWith("/contributors?per_page=100")) {
          return [{ login: "tianma-if", id: 5895871, contributions: 100, type: "User" }];
        }
        if (endpoint.endsWith("/stats/contributors")) {
          return [];
        }
        if (endpoint.endsWith("/commits?per_page=100")) {
          return [];
        }
        if (endpoint === "users/fresh-user") {
          return { login: "fresh-user", id: 123456 };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
      sidebarJson: () => ({
        contributors: {
          contributors: [
            {
              login: "Crowszzz",
              avatarUrl: "https://avatars.githubusercontent.com/u/75199133?s=64&v=4",
            },
          ],
        },
      }),
    });

    expect(contributors.map((item) => item.login)).toEqual([
      "tianma-if",
      "Crowszzz",
      "fresh-user",
    ]);
    expect(calls).toContain("api users/fresh-user");
  });

  test("appends and idempotently updates the contributors section across all five READMEs", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "edgeever-readme-contributors-"));
    try {
      for (const { file } of README_CONTRIBUTOR_SECTIONS) {
        writeFileSync(join(tempRoot, file), `# EdgeEver\n\nBody for ${file}\n`);
      }

      const initialContributors = [
        { login: "tianma-if", id: 5895871 },
        { login: "sivdead", id: 27731043 },
      ];
      const firstRun = syncReadmeContributors({
        repositoryRoot: tempRoot,
        contributors: initialContributors,
      });
      expect(firstRun.updatedFiles).toHaveLength(README_CONTRIBUTOR_SECTIONS.length);

      const secondRun = syncReadmeContributors({
        repositoryRoot: tempRoot,
        contributors: initialContributors,
      });
      expect(secondRun.updatedFiles).toEqual([]);

      const updatedContributors = [
        ...initialContributors,
        { login: "Sergmay911", id: 304439776 },
      ];
      const thirdRun = syncReadmeContributors({
        repositoryRoot: tempRoot,
        contributors: updatedContributors,
      });
      expect(thirdRun.updatedFiles).toHaveLength(README_CONTRIBUTOR_SECTIONS.length);

      const zhReadme = readFileSync(join(tempRoot, "README.zh-CN.md"), "utf8");
      expect(zhReadme).toContain("## 贡献者");
      expect(zhReadme).toContain(CONTRIBUTORS_START_MARKER);
      expect(zhReadme).toContain(CONTRIBUTORS_END_MARKER);
      expect(zhReadme).toContain(circularAvatarUrl(304439776));
      expect(zhReadme.match(/## 贡献者/g)).toHaveLength(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("preserves surrounding markdown when replacing an existing contributor marker block", () => {
    const input = [
      "# Title",
      "",
      "## Contributors",
      "",
      CONTRIBUTORS_START_MARKER,
      "<p>old</p>",
      CONTRIBUTORS_END_MARKER,
      "",
    ].join("\n");

    const output = upsertReadmeContributorsSection(input, {
      heading: "## Contributors",
      contributors: [{ login: "tianma-if", id: 5895871 }],
    });

    expect(output).not.toContain("<p>old</p>");
    expect(output).toContain('href="https://github.com/tianma-if"');
    expect(output.match(/## Contributors/g)).toHaveLength(1);
  });
});
