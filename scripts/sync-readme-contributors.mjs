import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPOSITORY = "tianma-if/edgeever";
export const CONTRIBUTORS_START_MARKER = "<!-- readme-contributors:start -->";
export const CONTRIBUTORS_END_MARKER = "<!-- readme-contributors:end -->";

export const README_CONTRIBUTOR_SECTIONS = [
  { file: "README.md", heading: "## Contributors" },
  { file: "README.zh-CN.md", heading: "## 贡献者" },
  { file: "README.zh-TW.md", heading: "## 貢獻者" },
  { file: "README.ja.md", heading: "## コントリビューター" },
  { file: "README.pl-PL.md", heading: "## Współtwórcy" },
];

const isBotLogin = (login) =>
  !login ||
  /\[bot\]$/i.test(login) ||
  login.toLowerCase() === "github-actions" ||
  login.toLowerCase() === "dependabot";

export const circularAvatarUrl = (userId) =>
  `https://images.weserv.nl/?url=https://avatars.githubusercontent.com/u/${userId}?v=4&h=96&w=96&fit=cover&mask=circle&maxage=7d`;

export const extractUserId = (user) => {
  if (typeof user?.id === "number" && Number.isFinite(user.id)) {
    return user.id;
  }
  const match = String(user?.avatar_url ?? user?.avatarUrl ?? "").match(
    /avatars\.githubusercontent\.com\/u\/(\d+)/,
  );
  return match ? Number(match[1]) : null;
};

export const parseExistingReadmeContributors = (markdown) => {
  const startIndex = markdown.indexOf(CONTRIBUTORS_START_MARKER);
  const endIndex = markdown.indexOf(CONTRIBUTORS_END_MARKER);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return [];
  }
  const block = markdown.slice(startIndex, endIndex);
  const results = [];
  const pattern =
    /<a\s+href="https:\/\/github\.com\/([^"/?#]+)"[^>]*><img\s+src="[^"]*avatars\.githubusercontent\.com\/u\/(\d+)[^"]*"/gi;
  for (const match of block.matchAll(pattern)) {
    results.push({
      login: match[1],
      id: Number(match[2]),
    });
  }
  return results;
};

export const mergeContributorSources = ({
  ownerLogin = "tianma-if",
  sidebarContributors = [],
  directContributors = [],
  statsContributors = [],
  recentCommits = [],
  existingContributors = [],
  extraUsers = [],
}) => {
  const byKey = new Map();
  let insertionOrder = 0;

  const upsert = (rawUser, contributions = 0) => {
    const login = String(rawUser?.login ?? "").trim();
    if (isBotLogin(login)) return;
    const id = extractUserId(rawUser);
    if (!id) return;

    const key = login.toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        login,
        id,
        contributions: Math.max(1, Number(contributions) || 1),
        order: insertionOrder++,
      });
      return;
    }

    existing.login = existing.login || login;
    existing.id = existing.id || id;
    existing.contributions = Math.max(
      existing.contributions,
      Number(contributions) || 1,
    );
  };

  for (const item of directContributors) {
    if (item?.type && item.type !== "User") continue;
    upsert(item, item?.contributions ?? 1);
  }

  const sortedStats = [...statsContributors].sort(
    (a, b) => (Number(b?.total) || 0) - (Number(a?.total) || 0),
  );
  for (const entry of sortedStats) {
    if (!entry?.author) continue;
    upsert(entry.author, entry.total ?? 1);
  }

  // GitHub's /_sidebar endpoint returns contributors ordered by rank (including Co-authored-by)
  sidebarContributors.forEach((user, index) => {
    const syntheticWeight = Math.max(1, 20 - index);
    const key = String(user?.login ?? "").trim().toLowerCase();
    if (byKey.has(key)) {
      upsert(user, byKey.get(key).contributions);
    } else {
      upsert(user, syntheticWeight > 2 ? 2 : 1);
    }
  });

  const commitCounts = new Map();
  const commitUsers = new Map();
  for (const commit of recentCommits) {
    for (const party of [commit?.author, commit?.committer]) {
      const login = String(party?.login ?? "").trim();
      if (!login || login.toLowerCase() === "web-flow" || isBotLogin(login)) {
        continue;
      }
      const key = login.toLowerCase();
      commitCounts.set(key, (commitCounts.get(key) ?? 0) + 1);
      if (!commitUsers.has(key)) {
        commitUsers.set(key, party);
      }
    }
  }
  for (const [key, party] of commitUsers.entries()) {
    upsert(party, commitCounts.get(key) ?? 1);
  }

  for (const user of existingContributors) {
    upsert(user, 1);
  }

  for (const user of extraUsers) {
    upsert(user, 1);
  }

  const ownerKey = ownerLogin.toLowerCase();
  return [...byKey.values()].sort((a, b) => {
    const aIsOwner = a.login.toLowerCase() === ownerKey;
    const bIsOwner = b.login.toLowerCase() === ownerKey;
    if (aIsOwner !== bIsOwner) return aIsOwner ? -1 : 1;
    if (b.contributions !== a.contributions) {
      return b.contributions - a.contributions;
    }
    return a.order - b.order;
  });
};

export const renderContributorsBlock = (contributors) => {
  const links = contributors.map(
    ({ login, id }) =>
      `  <a href="https://github.com/${login}"><img src="${circularAvatarUrl(id)}" width="48" height="48" alt="@${login}" /></a>`,
  );
  return [
    CONTRIBUTORS_START_MARKER,
    '<p align="left">',
    ...links,
    "</p>",
    CONTRIBUTORS_END_MARKER,
  ].join("\n");
};

export const upsertReadmeContributorsSection = (
  markdown,
  { heading, contributors },
) => {
  const block = renderContributorsBlock(contributors);
  const startIndex = markdown.indexOf(CONTRIBUTORS_START_MARKER);
  const endIndex = markdown.indexOf(CONTRIBUTORS_END_MARKER);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = markdown.slice(0, startIndex);
    const after = markdown.slice(endIndex + CONTRIBUTORS_END_MARKER.length);
    return `${before}${block}${after}`;
  }

  const trimmed = markdown.replace(/\s+$/, "");
  return `${trimmed}\n\n${heading}\n\n${block}\n`;
};

const runGhJson = (args) => {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output ? JSON.parse(output) : null;
};

const runSidebarJson = (repository) => {
  const output = execFileSync(
    "curl",
    [
      "-fsSL",
      "-H",
      "Accept: application/json",
      "-H",
      "X-Requested-With: XMLHttpRequest",
      `https://github.com/${repository}/_sidebar`,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  return output ? JSON.parse(output) : null;
};

export const fetchRepositoryContributors = ({
  repository = DEFAULT_REPOSITORY,
  extraLogins = [],
  existingContributors = [],
  ghJson = runGhJson,
  sidebarJson = runSidebarJson,
} = {}) => {
  const ownerLogin = repository.split("/")[0] || "tianma-if";

  const directRaw = ghJson([
    "api",
    `repos/${repository}/contributors?per_page=100`,
  ]);
  const directContributors = Array.isArray(directRaw) ? directRaw : [];

  let statsContributors = [];
  try {
    const statsRaw = ghJson(["api", `repos/${repository}/stats/contributors`]);
    if (Array.isArray(statsRaw)) {
      statsContributors = statsRaw;
    }
  } catch {
    // stats/contributors may return 202 while GitHub recomputes cache; fall back to other sources
  }

  let sidebarContributors = [];
  try {
    const sidebarRaw = sidebarJson(repository);
    if (Array.isArray(sidebarRaw?.contributors?.contributors)) {
      sidebarContributors = sidebarRaw.contributors.contributors;
    }
  } catch {
    // ignore transient web sidebar errors
  }

  let recentCommits = [];
  try {
    const commitsRaw = ghJson([
      "api",
      `repos/${repository}/commits?per_page=100`,
    ]);
    if (Array.isArray(commitsRaw)) {
      recentCommits = commitsRaw;
    }
  } catch {
    // ignore transient commit list errors
  }

  const knownKeys = new Set(
    [
      ...directContributors.map((u) => u?.login),
      ...statsContributors.map((s) => s?.author?.login),
      ...sidebarContributors.map((u) => u?.login),
      ...recentCommits.map((c) => c?.author?.login),
      ...existingContributors.map((u) => u?.login),
    ]
      .filter(Boolean)
      .map((login) => String(login).toLowerCase()),
  );

  const extraUsers = [];
  for (const rawLogin of extraLogins) {
    const login = String(rawLogin ?? "").trim().replace(/^@/, "");
    if (!login || isBotLogin(login) || knownKeys.has(login.toLowerCase())) {
      continue;
    }
    try {
      const user = ghJson(["api", `users/${login}`]);
      if (user?.login && user?.id) {
        extraUsers.push(user);
        knownKeys.add(login.toLowerCase());
      }
    } catch {
      // ignore unresolvable user
    }
  }

  return mergeContributorSources({
    ownerLogin,
    sidebarContributors,
    directContributors,
    statsContributors,
    recentCommits,
    existingContributors,
    extraUsers,
  });
};

export const syncReadmeContributors = ({
  repositoryRoot = resolve(import.meta.dir, ".."),
  repository = DEFAULT_REPOSITORY,
  extraLogins = [],
  contributors,
  ghJson,
  sidebarJson,
} = {}) => {
  const primaryReadmePath = resolve(repositoryRoot, "README.md");
  const existingContributors = existsSync(primaryReadmePath)
    ? parseExistingReadmeContributors(readFileSync(primaryReadmePath, "utf8"))
    : [];

  const resolvedContributors =
    contributors ??
    fetchRepositoryContributors({
      repository,
      extraLogins,
      existingContributors,
      ghJson,
      sidebarJson,
    });

  if (!Array.isArray(resolvedContributors) || resolvedContributors.length === 0) {
    return { updatedFiles: [], contributors: [] };
  }

  const updatedFiles = [];
  for (const { file, heading } of README_CONTRIBUTOR_SECTIONS) {
    const fullPath = resolve(repositoryRoot, file);
    if (!existsSync(fullPath)) continue;
    const current = readFileSync(fullPath, "utf8");
    const next = upsertReadmeContributorsSection(current, {
      heading,
      contributors: resolvedContributors,
    });
    if (next !== current) {
      writeFileSync(fullPath, next);
      updatedFiles.push(file);
    }
  }

  return {
    updatedFiles,
    contributors: resolvedContributors,
  };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const extraLogins = process.argv.slice(2).filter(Boolean);
  const { updatedFiles, contributors } = syncReadmeContributors({
    extraLogins,
  });
  console.log(
    `[contributors] synced ${contributors.length} contributors (${updatedFiles.length} README files updated)`,
  );
}
