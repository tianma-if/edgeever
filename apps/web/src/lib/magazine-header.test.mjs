import { describe, expect, test } from "bun:test";
import {
  cleanChapterHeadingText,
  deriveChapterCardLabels,
  splitCoverTitle,
} from "./magazine-header.ts";

describe("splitCoverTitle", () => {
  test("preserves original English and Chinese punctuation when splitting", () => {
    expect(
      splitCoverTitle("Building an AI-Native, Cross-Platform Evernote/Notion Alternative on Cloudflare ($0 Server Cost)"),
    ).toEqual({
      primary: "Building an AI-Native, ",
      highlight: "Cross-Platform Evernote/Notion Alternative on Cloudflare ($0 Server Cost)",
    });

    expect(splitCoverTitle("EdgeEver 架构拆解：如何用 Cloudflare 零成本部署")).toEqual({
      primary: "EdgeEver 架构拆解：",
      highlight: "如何用 Cloudflare 零成本部署",
    });

    expect(splitCoverTitle("EdgeEver Architecture: Zero-Cost Deployment on Cloudflare")).toEqual({
      primary: "EdgeEver Architecture: ",
      highlight: "Zero-Cost Deployment on Cloudflare",
    });

    expect(splitCoverTitle("深度评测 —— 从迁移到离线同步")).toEqual({
      primary: "深度评测 —— ",
      highlight: "从迁移到离线同步",
    });
  });

  test("splits long titles without delimiters at word boundaries for spaced text", () => {
    expect(splitCoverTitle("Building an AI-Native Workspace on Cloudflare")).toEqual({
      primary: "Building an AI-Native ",
      highlight: "Workspace on Cloudflare",
    });

    expect(splitCoverTitle("10:30 发布复盘与深度架构总结")).toEqual({
      primary: "10:30 ",
      highlight: "发布复盘与深度架构总结",
    });

    expect(splitCoverTitle("零成本部署个人云笔记指南")).toEqual({
      primary: "零成本部署个",
      highlight: "人云笔记指南",
    });
  });

  test("does not split short titles and falls back cleanly when empty", () => {
    expect(splitCoverTitle("深度评测文章")).toEqual({ primary: "深度评测文章", highlight: "" });
    expect(splitCoverTitle("   ")).toEqual({ primary: "深度实测与结构化指南", highlight: "" });
  });
});

describe("deriveChapterCardLabels", () => {
  test("strips numbering prefixes cleanly", () => {
    expect(cleanChapterHeadingText("1. One Worker to Serve Everything")).toBe("One Worker to Serve Everything");
    expect(cleanChapterHeadingText("第2章：数据同步架构")).toBe("数据同步架构");
    expect(cleanChapterHeadingText("三、总结与展望")).toBe("总结与展望");
  });

  test("never slices English words in half", () => {
    const headings = [
      "1. One Worker to Serve Everything (Frontend, API, Static Assets)",
      "2. Protect Worker CPU Like Gold: Push Heavy Work Out",
      "3. Treat D1 Row Reads as a First-Class Budget",
      "7. Decoupled by Design: Cloudflare + Docker",
      "What's Next",
    ];
    const results = headings.map((heading, idx) => deriveChapterCardLabels(heading, idx));

    expect(results[0]).toEqual({
      num: "01",
      shortTitle: "One Worker to",
      subTitle: "Serve Everything…",
    });
    expect(results[1]).toEqual({
      num: "02",
      shortTitle: "Protect Worker",
      subTitle: "CPU Like Gold · Push…",
    });
    expect(results[2]).toEqual({
      num: "03",
      shortTitle: "Treat D1 Row",
      subTitle: "Reads as a First-Class…",
    });
    expect(results[3]).toEqual({
      num: "04",
      shortTitle: "Decoupled by",
      subTitle: "Design · Cloudflare +…",
    });
    expect(results[4]).toEqual({
      num: "05",
      shortTitle: "What's Next",
      subTitle: "PART 05",
    });
  });

  test("formats Chinese headings cleanly with clause separation and fallback", () => {
    expect(deriveChapterCardLabels("效率工具箱：斜杠指令、双链与数学公式", 0)).toEqual({
      num: "01",
      shortTitle: "效率工具箱",
      subTitle: "斜杠指令 · 双链与数学公式",
    });
    expect(deriveChapterCardLabels("章节标题", 1)).toEqual({
      num: "02",
      shortTitle: "章节标题",
      subTitle: "PART 02",
    });
  });
});
