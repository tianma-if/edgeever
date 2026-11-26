const GITHUB_NEW_ISSUE_URL = "https://github.com/tianma-if/edgeever/issues/new";
// Leave room for GitHub to encode the URL again in a sign-in redirect.
const MAX_GITHUB_ISSUE_URL_LENGTH = 4_000;

export type GitHubFeedbackSystemInfoItem = {
  label: string;
  value: string;
};

const formatSystemInfo = (items: GitHubFeedbackSystemInfoItem[]) =>
  items.map((item) => `- ${item.label}: ${item.value}`).join("\n");

export const buildGitHubDiagnosticFeedback = ({
  diagnostics,
  systemInfo,
  titlePrefix,
}: {
  diagnostics: string;
  systemInfo: GitHubFeedbackSystemInfoItem[];
  titlePrefix: string;
}) => {
  const url = new URL(GITHUB_NEW_ISSUE_URL);
  url.searchParams.set("template", "bug.yml");
  url.searchParams.set("title", titlePrefix);
  const manualFields: { label: string; text: string }[] = [];

  for (const [id, label, value] of [
    ["system-info", "System information", formatSystemInfo(systemInfo)],
    ["diagnostics", "Diagnostics", diagnostics],
  ]) {
    url.searchParams.set(id, value);
    if (url.href.length > MAX_GITHUB_ISSUE_URL_LENGTH) {
      url.searchParams.delete(id);
      manualFields.push({ label, text: value });
    }
  }

  return { url: url.href, manualFields };
};

export const buildGitHubFeedbackUrl = ({
  contentHeading,
  contentPrompt,
  privacyNotice,
  systemInfo,
  systemInfoHeading,
  systemInfoNotice,
  titlePrefix,
  client,
}: {
  contentHeading: string;
  contentPrompt: string;
  privacyNotice: string;
  systemInfo: GitHubFeedbackSystemInfoItem[];
  systemInfoHeading: string;
  systemInfoNotice: string;
  titlePrefix: string;
  client?: string;
}) => {
  const systemInfoText = formatSystemInfo(systemInfo);
  const body = [
    `## ${contentHeading}`,
    "",
    `<!-- ${contentPrompt} -->`,
    "",
    `## ${systemInfoHeading}`,
    "",
    `<!-- ${systemInfoNotice} -->`,
    systemInfoText,
    "",
    `> ${privacyNotice}`,
  ].join("\n");
  const params = new URLSearchParams({
    title: titlePrefix,
    body,
    "system-info": systemInfoText,
  });
  if (client) params.set("client", client);
  return `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
};
