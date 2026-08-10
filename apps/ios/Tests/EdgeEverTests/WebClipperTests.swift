import XCTest
@testable import EdgeEver

final class WebClipperTests: XCTestCase {
    func testSharedWebURLFindsURLInsideText() {
        let payloads = [ShareHandoffStore.SharePayload(
            text: "Read this https://example.com/articles/one?from=share today",
            url: nil,
            title: nil
        )]
        XCTAssertEqual(
            WebClipper.sharedWebURL(from: payloads)?.absoluteString,
            "https://example.com/articles/one?from=share"
        )
    }

    func testRenderedPageCreatesMarkdownWithResolvedLinksAndImages() throws {
        let source = try XCTUnwrap(URL(string: "https://example.com/articles/one"))
        let draft = WebClipper.buildRendered(
            source,
            page: RenderedWebPage(
                title: " Example article ",
                contentHTML: "<h2>Heading</h2><p>Hello <strong>world</strong>.</p><img data-src=\"/cover.png\" alt=\"Cover\"><a href=\"/docs\">Docs</a>",
                finalURL: source.absoluteString
            ),
            capturedAt: Date(timeIntervalSince1970: 0)
        )

        XCTAssertEqual(draft.title, "Example article")
        XCTAssertEqual(draft.tagsText, "web-clip")
        XCTAssertTrue(draft.contentMarkdown.contains("## Heading"))
        XCTAssertTrue(draft.contentMarkdown.contains("Hello **world**."))
        XCTAssertTrue(draft.contentMarkdown.contains("![Cover](https://example.com/cover.png)"))
        XCTAssertTrue(draft.contentMarkdown.contains("[Docs](https://example.com/docs)"))
        XCTAssertTrue(draft.contentMarkdown.contains("来源：[https://example.com/articles/one]"))
    }

    func testWeChatRenderedPageUsesWechatTag() throws {
        let source = try XCTUnwrap(URL(string: "https://mp.weixin.qq.com/s/example"))
        let draft = WebClipper.buildRendered(
            source,
            page: RenderedWebPage(
                title: "微信文章",
                contentHTML: "<p>正文</p>",
                finalURL: source.absoluteString
            )
        )
        XCTAssertEqual(draft.tagsText, "web-clip, wechat")
        XCTAssertTrue(draft.contentMarkdown.contains("正文"))
    }

    func testEmptyRenderedBodyFallsBackButKeepsRenderedTitle() throws {
        let source = try XCTUnwrap(URL(string: "https://example.com/a"))
        let draft = WebClipper.buildRendered(
            source,
            page: RenderedWebPage(title: "Known title", contentHTML: "", finalURL: source.absoluteString)
        )
        XCTAssertEqual(draft.title, "Known title")
        XCTAssertTrue(draft.contentMarkdown.contains("正文暂时无法抓取"))
        XCTAssertTrue(draft.contentMarkdown.contains(source.absoluteString))
    }
}
