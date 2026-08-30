const GITHUB_NEW_ISSUE_URL = "https://github.com/tianma-if/edgeever/issues/new";

export type GitHubFeedbackSystemInfoItem = {
  label: string;
  value: string;
};

export const buildGitHubFeedbackUrl = ({
  contentHeading,
  contentPrompt,
  diagnostics,
  privacyNotice,
  systemInfo,
  systemInfoHeading,
  systemInfoNotice,
  titlePrefix,
}: {
  contentHeading: string;
  contentPrompt: string;
  diagnostics?: {
    heading: string;
    notice: string;
    text: string;
  };
  privacyNotice: string;
  systemInfo: GitHubFeedbackSystemInfoItem[];
  systemInfoHeading: string;
  systemInfoNotice: string;
  titlePrefix: string;
}) => {
  const body = [
    `## ${contentHeading}`,
    "",
    `<!-- ${contentPrompt} -->`,
    "",
    ...(diagnostics ? [
      `## ${diagnostics.heading}`,
      "",
      `<!-- ${diagnostics.notice} -->`,
      "",
      "```json",
      diagnostics.text,
      "```",
      "",
    ] : []),
    `## ${systemInfoHeading}`,
    "",
    `<!-- ${systemInfoNotice} -->`,
    ...systemInfo.map((item) => `- ${item.label}: ${item.value}`),
    "",
    `> ${privacyNotice}`,
  ].join("\n");
  return `${GITHUB_NEW_ISSUE_URL}?title=${encodeURIComponent(titlePrefix)}&body=${encodeURIComponent(body)}`;
};
