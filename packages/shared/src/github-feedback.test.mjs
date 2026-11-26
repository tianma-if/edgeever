import { describe, expect, test } from "bun:test";
import { buildGitHubDiagnosticFeedback } from "./github-feedback";

const titlePrefix = "[同步] 桌面端同步需要处理";
const systemInfo = [{ label: "版本", value: "v2.32.0" }];

describe("GitHub diagnostic feedback", () => {
  test("prefills short diagnostics once, in the bug form field", () => {
    const diagnostics = JSON.stringify({ errorCode: "memo_not_found" });
    const report = buildGitHubDiagnosticFeedback({ diagnostics, systemInfo, titlePrefix });
    const url = new URL(report.url);

    expect(report.manualFields).toEqual([]);
    expect(url.origin + url.pathname).toBe("https://github.com/tianma-if/edgeever/issues/new");
    expect(url.searchParams.get("title")).toBe(titlePrefix);
    expect(url.searchParams.get("body")).toBeNull();
    expect(url.searchParams.get("system-info")).toBe("- 版本: v2.32.0");
    expect(url.searchParams.get("template")).toBe("bug.yml");
    expect(url.searchParams.get("diagnostics")).toBe(diagnostics);
  });

  test("keeps the full diagnostics available for pasting when the encoded URL is too long", () => {
    const diagnostics = JSON.stringify({
      items: Array.from({ length: 5 }, () => ({
        kind: "memo.deleteBatch",
        lastError: "批量删除笔记失败 🚫".repeat(15),
        lastErrorCode: "http_400",
      })),
    }, null, 2);
    expect(diagnostics.length).toBeLessThan(4_000);
    const report = buildGitHubDiagnosticFeedback({ diagnostics, systemInfo, titlePrefix });
    const url = new URL(report.url);

    expect(report.url.length).toBeLessThanOrEqual(4_000);
    expect(report.manualFields).toEqual([{ label: "Diagnostics", text: diagnostics }]);
    expect(url.searchParams.get("template")).toBe("bug.yml");
    expect(url.searchParams.get("title")).toBe(titlePrefix);
    expect(url.searchParams.get("system-info")).toBe("- 版本: v2.32.0");
    expect(url.searchParams.get("diagnostics")).toBeNull();
  });

  test("offers oversized system information for pasting while still prefilling short diagnostics", () => {
    const value = "本地构建".repeat(1_200);
    const diagnostics = '{"errorCode":"http_400"}';
    const report = buildGitHubDiagnosticFeedback({
      diagnostics,
      systemInfo: [{ label: "构建", value }],
      titlePrefix,
    });
    const url = new URL(report.url);

    expect(report.url.length).toBeLessThanOrEqual(4_000);
    expect(report.manualFields).toEqual([{ label: "System information", text: `- 构建: ${value}` }]);
    expect(url.searchParams.get("system-info")).toBeNull();
    expect(url.searchParams.get("diagnostics")).toBe(diagnostics);
  });
});
