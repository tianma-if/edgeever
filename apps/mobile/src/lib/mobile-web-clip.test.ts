import { describe, expect, test } from "bun:test";
import {
  buildMobileWebClipDraft,
  buildMobileWebClipDraftFromRenderedPage,
  extractPageTitle,
  getSharedImages,
  getSharedWebUrl,
  htmlToMarkdown,
  isWeChatArticleUrl,
} from "./mobile-web-clip";

describe("mobile web clip", () => {
  test("normalizes resolved images shared by another Android app", () => {
    expect(getSharedImages([
      {
        contentMimeType: "image/webp",
        contentType: "image",
        contentUri: "file:///cache/zhihu-image.webp",
        mimeType: "image/*",
        originalName: "zhihu-image.webp",
        shareType: "image",
        value: "content://com.zhihu.android/image/42",
      },
    ])).toEqual([{
      mimeType: "image/webp",
      name: "zhihu-image.webp",
      uri: "file:///cache/zhihu-image.webp",
    }]);
  });

  test("extracts a WeChat URL embedded in shared text", () => {
    expect(getSharedWebUrl([
      { shareType: "text", value: "一篇文章\nhttps://mp.weixin.qq.com/s/abc123" },
    ])).toBe("https://mp.weixin.qq.com/s/abc123");
    expect(isWeChatArticleUrl("https://mp.weixin.qq.com/s/abc123")).toBe(true);
    expect(isWeChatArticleUrl("http://mp.weixin.qq.com/s/abc123")).toBe(false);
  });

  test("extracts title regardless of meta attribute order", () => {
    expect(extractPageTitle('<meta content="公众号文章标题 &amp; 更多" property="og:title">'))
      .toBe("公众号文章标题 & 更多");
  });

  test("turns common article HTML into readable markdown", () => {
    const markdown = htmlToMarkdown(`
      <section>
        <h2>第一节</h2>
        <p>正文<strong>重点</strong><br>下一行</p>
        <img data-src="https://mmbiz.qpic.cn/example.jpg" alt="示例图">
        <p><a href="https://example.com">阅读更多</a></p>
      </section>
    `);
    expect(markdown).toContain("## 第一节");
    expect(markdown).toContain("正文**重点**\n下一行");
    expect(markdown).toContain("![示例图](https://mmbiz.qpic.cn/example.jpg)");
    expect(markdown).toContain("[阅读更多](https://example.com)");
  });

  test("builds a complete WeChat clip from nested js_content", async () => {
    const html = `
      <html><head><meta property="og:title" content="测试文章"></head>
      <body><div id="js_content"><section><p>开头</p><div><p>嵌套正文</p></div></section></div></body></html>
    `;
    const draft = await buildMobileWebClipDraft("https://mp.weixin.qq.com/s/test", {
      capturedAt: new Date("2026-07-31T00:00:00.000Z"),
      fetcher: async () => new Response(html, { status: 200 }),
    });
    expect(draft.title).toBe("测试文章");
    expect(draft.tagsText).toBe("web-clip, wechat");
    expect(draft.contentMarkdown).toContain("开头");
    expect(draft.contentMarkdown).toContain("嵌套正文");
    expect(draft.contentMarkdown).toContain("2026-07-31T00:00:00.000Z");
  });

  test("builds a WeChat clip from a rendered WebView page", () => {
    const draft = buildMobileWebClipDraftFromRenderedPage(
      "https://mp.weixin.qq.com/s/rendered",
      {
        title: "渲染后的公众号标题 &amp; 更多",
        finalUrl: "https://mp.weixin.qq.com/s/rendered",
        contentHtml: `
          <section>
            <p>这是浏览器渲染后提取的正文。</p>
            <img data-src="//mmbiz.qpic.cn/example.jpg" alt="文章配图">
            <a href="/s/related">相关文章</a>
          </section>
        `,
      },
      { capturedAt: new Date("2026-07-31T00:00:00.000Z") },
    );

    expect(draft.title).toBe("渲染后的公众号标题 & 更多");
    expect(draft.contentMarkdown).toContain("这是浏览器渲染后提取的正文。");
    expect(draft.contentMarkdown).toContain(
      "![文章配图](https://mmbiz.qpic.cn/example.jpg)",
    );
    expect(draft.contentMarkdown).toContain(
      "[相关文章](https://mp.weixin.qq.com/s/related)",
    );
  });

  test("keeps the source URL when fetching fails", async () => {
    const draft = await buildMobileWebClipDraft("https://mp.weixin.qq.com/s/offline", {
      fetcher: async () => {
        throw new Error("offline");
      },
    });
    expect(draft.contentMarkdown).toContain("https://mp.weixin.qq.com/s/offline");
    expect(draft.contentMarkdown).toContain("正文暂时无法抓取");
  });
});
