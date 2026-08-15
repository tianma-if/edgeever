import XCTest
@testable import EdgeEver

final class MemoTemplatesTests: XCTestCase {
    func testCreateSeedFromSelectableTemplate() {
        let template = SelectableMemoTemplate(MemoTemplate(
            id: "tpl",
            name: "我的周报",
            description: "desc",
            title: "【周报】",
            contentMarkdown: "## 本周",
            tags: ["work", "weekly"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        ))
        XCTAssertEqual(template.createSeed.title, "【周报】")
        XCTAssertEqual(template.createSeed.contentMarkdown, "## 本周")
        XCTAssertEqual(template.createSeed.tagsText, "work, weekly")
        XCTAssertTrue(template.createSeed.hasContent)
        XCTAssertFalse(CreateMemoSeed(title: "", contentMarkdown: "", tagsText: "").hasContent)
        XCTAssertTrue(CreateMemoSeed(title: "a", contentMarkdown: "", tagsText: "").hasContent)
    }

    func testFromSavedMapsServerTemplate() {
        let saved = MemoTemplate(
            id: "tpl_1",
            name: "自定义",
            description: "说明",
            title: nil,
            contentMarkdown: "# Hi",
            tags: ["x"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        )
        let row = SelectableMemoTemplate(saved)
        XCTAssertEqual(row.title, "自定义")
        XCTAssertEqual(row.contentMarkdown, "# Hi")
    }
}
