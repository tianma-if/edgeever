import { describe, expect, test } from "bun:test";
import { buildGitHubFeedbackUrl } from "./github-feedback";

describe("GitHub feedback URL", () => {
  test("includes optional diagnostics before system information", () => {
    const url = new URL(buildGitHubFeedbackUrl({
      contentHeading: "What happened",
      contentPrompt: "Describe the problem.",
      diagnostics: {
        heading: "Diagnostics",
        notice: "Review before submitting.",
        text: JSON.stringify({ errorCode: "memo_not_found" }),
      },
      privacyNotice: "Public report.",
      systemInfo: [{ label: "Version", value: "v1.46.0" }],
      systemInfoHeading: "System information",
      systemInfoNotice: "Generated locally.",
      titlePrefix: "[Sync] ",
    }));

    expect(url.origin + url.pathname).toBe("https://github.com/tianma-if/edgeever/issues/new");
    expect(url.searchParams.get("title")).toBe("[Sync] ");
    const body = url.searchParams.get("body");
    expect(body).toContain("## Diagnostics");
    expect(body).toContain('"errorCode":"memo_not_found"');
    expect(body).toContain("- Version: v1.46.0");
    expect(body.indexOf("## Diagnostics")).toBeLessThan(body.indexOf("## System information"));
  });
});
