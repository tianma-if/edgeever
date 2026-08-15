import XCTest
@testable import EdgeEver

final class LocalMirrorTests: XCTestCase {
    func testUpsertListAndSearch() throws {
        let db = try AppDatabase.makeEmpty()
        let mirror = LocalMirrorRepository(dbQueue: db)
        let scope = "https://demo.example|u1"
        let now = EdgeEverDate.nowString()
        let notebook = Notebook(
            id: "nb1",
            parentId: nil,
            name: "Inbox",
            slug: nil,
            icon: nil,
            color: nil,
            sortOrder: 0,
            memoCount: 0,
            lastMemoUpdatedAt: nil,
            createdAt: now,
            updatedAt: now
        )
        try mirror.applyBootstrapBatch(scope: scope, notebooks: [notebook], memos: [
            MemoDetail.localPlaceholder(
                id: "m1",
                notebookId: "nb1",
                title: "Hello",
                contentMarkdown: "world content",
                tags: ["a"],
                createdAt: now
            ),
        ])
        try mirror.setCursor(scope: scope, cursor: 1)
        try mirror.setIdentity(scope: scope, identity: "id1")
        XCTAssertTrue(try mirror.isInitialized(scope: scope))

        let notebooks = try mirror.listNotebooks(scope: scope)
        XCTAssertEqual(notebooks.count, 1)
        XCTAssertEqual(notebooks[0].memoCount, 1)

        let listed = try mirror.listMemos(scope: scope, params: .init(q: "world"))
        XCTAssertEqual(listed.totalCount, 1)
        XCTAssertEqual(listed.memos.first?.title, "Hello")

        let tags = try mirror.listTags(scope: scope)
        XCTAssertEqual(tags, [TagSummary(name: "a", memoCount: 1, updatedAt: now)])
    }

    func testOutboxCreateAbsorbsUpdate() throws {
        let db = try AppDatabase.makeEmpty()
        let outbox = SyncOutboxRepository(dbQueue: db)
        let scope = "s"
        try outbox.enqueueCreate(
            scope: scope,
            payload: MemoCreatePayload(
                memoId: "local:1",
                title: "A",
                contentMarkdown: "one",
                notebookId: "nb",
                tags: [],
                createdAt: EdgeEverDate.nowString()
            )
        )
        try outbox.enqueueUpdate(
            scope: scope,
            payload: MemoUpdatePayload(
                memoId: "local:1",
                expectedRevision: 0,
                expectedContentHash: "",
                title: "B",
                contentMarkdown: "two",
                notebookId: "nb",
                tags: ["t"]
            )
        )
        let items = try outbox.listItems(scope: scope)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].kind, .memoCreate)
        let payload = try items[0].createPayload()
        XCTAssertEqual(payload.title, "B")
        XCTAssertEqual(payload.contentMarkdown, "two")
        XCTAssertEqual(payload.tags, ["t"])
    }
}
