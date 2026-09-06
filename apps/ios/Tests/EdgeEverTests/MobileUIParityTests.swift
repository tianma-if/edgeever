import WebKit
import XCTest
@testable import EdgeEver

/// Exercises shipped parity helpers (same semantics as Android `@edgeever/shared/mobile-ui` + notebooks).
final class MobileUIParityTests: XCTestCase {
    func testToggleFilterReturnsToAllWhenPressedAgain() {
        XCTAssertEqual(
            MobileUI.toggleMemoFilterMode(current: .all, requested: .pinned),
            .pinned
        )
        XCTAssertEqual(
            MobileUI.toggleMemoFilterMode(current: .pinned, requested: .pinned),
            .all
        )
        XCTAssertEqual(
            MobileUI.toggleMemoFilterMode(current: .pinned, requested: .tagged),
            .tagged
        )
    }

    func testToggleSelectionAddAndRemove() {
        let once = MobileUI.toggleMemoSelection(current: [], memoId: "a")
        XCTAssertEqual(once, ["a"])
        let twice = MobileUI.toggleMemoSelection(current: once, memoId: "a")
        XCTAssertTrue(twice.isEmpty)
        let multi = MobileUI.toggleMemoSelection(current: once, memoId: "b")
        XCTAssertEqual(multi, ["a", "b"])
    }

    func testMemoListTimestampMatchesSortMode() {
        let memo = MemoSummary(
            id: "memo",
            notebookId: "notebook",
            title: "Imported",
            excerpt: "",
            tags: [],
            isPinned: false,
            isArchived: false,
            isDeleted: false,
            revision: 0,
            createdAt: "2010-08-30T02:00:00.000Z",
            updatedAt: "2026-08-25T01:59:00.000Z",
            deletedAt: nil
        )

        XCTAssertEqual(MemoListTimestampField.resolve(for: .createdDesc).value(from: memo), memo.createdAt)
        XCTAssertEqual(MemoListTimestampField.resolve(for: .updatedDesc).value(from: memo), memo.updatedAt)
        XCTAssertEqual(MemoListTimestampField.resolve(for: .titleAsc).value(from: memo), memo.updatedAt)
    }

    func testMemoDetailDateIncludesHistoricalYear() {
        let value = MemoDetailDate.format(
            "2010-08-30T12:34:00.000Z",
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(secondsFromGMT: 0)!
        )
        XCTAssertTrue(value.contains("2010"))
        XCTAssertEqual(MemoDetailDate.format("not-a-date"), "")
    }

    func testNotebookDescendantsMatchTree() {
        let notebooks = [
            makeNotebook(id: "root", parent: nil, name: "Root", order: 0),
            makeNotebook(id: "child", parent: "root", name: "Child", order: 0),
            makeNotebook(id: "grand", parent: "child", name: "Grand", order: 0),
            makeNotebook(id: "other", parent: nil, name: "Other", order: 1),
        ]
        let ids = NotebookHierarchy.descendantIds(notebooks: notebooks, targetNotebookId: "root")
        XCTAssertEqual(Set(ids), Set(["root", "child", "grand"]))
    }

    func testFilterCollapsedHidesDescendants() {
        let notebooks = [
            makeNotebook(id: "root", parent: nil, name: "Root", order: 0),
            makeNotebook(id: "child", parent: "root", name: "Child", order: 0),
            makeNotebook(id: "grand", parent: "child", name: "Grand", order: 0),
            makeNotebook(id: "other", parent: nil, name: "Other", order: 1),
        ]
        let tree = NotebookHierarchy.treeItems(from: notebooks)
        let filtered = NotebookHierarchy.filterCollapsed(items: tree, collapsedIds: ["root"])
        XCTAssertEqual(filtered.map(\.id), ["root", "other"])
    }

    func testNotebookSearchIncludesAncestorsAndDescendants() {
        let notebooks = [
            makeNotebook(id: "work", parent: nil, name: "Work", order: 0),
            makeNotebook(id: "proj", parent: "work", name: "Project Alpha", order: 0),
            makeNotebook(id: "note", parent: "proj", name: "Daily", order: 0),
            makeNotebook(id: "home", parent: nil, name: "Home", order: 1),
        ]
        let visible = NotebookHierarchy.searchVisibleIds(notebooks: notebooks, searchText: "alpha")
        XCTAssertTrue(visible.contains("proj"))
        XCTAssertTrue(visible.contains("work")) // ancestor
        XCTAssertTrue(visible.contains("note")) // descendant
        XCTAssertFalse(visible.contains("home"))
    }

    func testResourcePathNormalizationAddsBlob() {
        let base = URL(string: "https://demo.edgeever.org")!
        XCTAssertEqual(
            ResourceCache.normalizeProtectedResourcePath("/api/v1/resources/abc123", baseURL: base),
            "/api/v1/resources/abc123/blob"
        )
        XCTAssertEqual(
            ResourceCache.normalizeProtectedResourcePath("/api/v1/resources/abc123/blob", baseURL: base),
            "/api/v1/resources/abc123/blob"
        )
        XCTAssertEqual(
            ResourceCache.normalizeProtectedResourcePath("https://demo.edgeever.org/api/v1/resources/xyz", baseURL: base),
            "/api/v1/resources/xyz/blob"
        )
        XCTAssertTrue(ResourceCache.isProtectedResourceSource("/api/v1/resources/x", baseURL: base))
        XCTAssertTrue(
            ResourceCache.isProtectedResourceSource("https://demo.edgeever.org/api/v1/resources/x/blob", baseURL: base)
        )
        XCTAssertFalse(ResourceCache.isProtectedResourceSource("https://cdn.example/img.png", baseURL: base))
    }

    func testLoadResourceDataURLPassthroughDataURI() async {
        let cache = ResourceCache()
        let dataURL = "data:image/png;base64,iVBORw0KGgo="
        let loaded = await TipTapWebView.Coordinator.loadResourceDataURL(
            source: dataURL,
            baseURL: URL(string: "https://demo.edgeever.org"),
            token: "tok",
            resourceCache: cache
        )
        XCTAssertEqual(loaded, dataURL)
    }

    func testLoadResourceDataURLBuildsSchemeURLFromProtectedBlob() async throws {
        // Local static file server is not required — exercise cache write path via dataURL helper.
        let cache = ResourceCache()
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG magic
        let url = try await cache.dataURL(for: "res-test-1", data: png, mimeType: "image/png")
        XCTAssertTrue(url.hasPrefix("data:image/png;base64,"))
        let cached = await cache.cachedData(for: "res-test-1")
        XCTAssertEqual(cached, png)
        // loadResourceDataURL should hit cache and return edgeever-res:// scheme URL for WKWebView.
        let loaded = await TipTapWebView.Coordinator.loadResourceDataURL(
            source: "/api/v1/resources/res-test-1/blob",
            baseURL: URL(string: "https://demo.edgeever.org"),
            token: "tok",
            resourceCache: cache
        )
        XCTAssertEqual(loaded, EdgeEverResourceSchemeHandler.localURL(for: "res-test-1"))
        let blob = await ResourceBlobStore.shared.get(id: "res-test-1")
        XCTAssertEqual(blob?.data, png)
        XCTAssertEqual(blob?.mimeType, "image/png")
    }

    func testDemoCatSvgIsNotMislabeledAsJpeg() {
        let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>"#.utf8)
        XCTAssertTrue(TipTapWebView.Coordinator.isSvgData(svg))
        XCTAssertEqual(TipTapWebView.Coordinator.sniffImageMime(svg), "image/svg+xml")
        // Cache re-hit path must not report jpeg for SVG bytes.
        XCTAssertEqual(
            TipTapWebView.Coordinator.resolvedImageMime(header: "application/octet-stream", data: svg),
            "image/svg+xml"
        )
        XCTAssertEqual(
            TipTapWebView.Coordinator.resolvedImageMime(header: "image/svg+xml", data: svg),
            "image/svg+xml"
        )
    }

    func testLoadResourceDataURLReturnsDataURLForCachedSvg() async throws {
        // Use a test-only resource id — never write over real demo cache keys on the simulator.
        let cache = ResourceCache()
        let testId = "res_unit_test_svg_\(UUID().uuidString.prefix(8))"
        let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4"/></svg>"#.utf8)
        _ = try await cache.dataURL(for: testId, data: svg, mimeType: "image/jpeg") // wrong mime on disk write is OK
        let loaded = await TipTapWebView.Coordinator.loadResourceDataURL(
            source: "/api/v1/resources/\(testId)/blob",
            baseURL: URL(string: "http://127.0.0.1:8787"),
            token: nil,
            resourceCache: cache
        )
        XCTAssertNotNil(loaded)
        XCTAssertTrue(loaded!.hasPrefix("data:image/svg+xml"), "SVG demo asset must become data:image/svg+xml, got \(loaded!.prefix(40))")
        // Cleanup so tests don't leave junk in the shared caches directory.
        let stale = await cache.fileURL(for: testId)
        try? FileManager.default.removeItem(at: stale)
    }

    func testResourceTargetParseExtractsIdFromBlobPath() {
        let json = """
        {"kind":"image","href":"/api/v1/resources/res_demo_cat_image/blob","filename":"猫","resourceId":"blob"}
        """
        let target = ResourceTarget.parse(json)
        XCTAssertEqual(target?.resourceId, "res_demo_cat_image")
        XCTAssertEqual(target?.kind, .image)
        XCTAssertTrue(target?.href.hasSuffix("/blob") == true)
    }

    func testResourceTargetParseAttachment() {
        let json = """
        {"kind":"attachment","href":"/api/v1/resources/res_file_1/blob","filename":"附件：brief.pdf","resourceId":"res_file_1"}
        """
        let target = ResourceTarget.parse(json)
        XCTAssertEqual(target?.resourceId, "res_file_1")
        XCTAssertEqual(target?.filename, "brief.pdf")
        XCTAssertEqual(target?.kind, .attachment)
    }

    func testHydrateImageSourcesInJSONRewritesProtectedSrc() async throws {
        let cache = ResourceCache()
        let testId = "res_unit_test_json_\(UUID().uuidString.prefix(8))"
        let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>"#.utf8)
        _ = try await cache.dataURL(for: testId, data: svg, mimeType: "image/svg+xml")
        let input = """
        {"type":"doc","content":[{"type":"image","attrs":{"src":"/api/v1/resources/\(testId)/blob","alt":"cat","title":null,"width":35}}]}
        """
        let out = await TipTapWebView.Coordinator.hydrateImageSourcesInJSON(
            input,
            baseURL: URL(string: "http://127.0.0.1:8787"),
            token: nil,
            resourceCache: cache
        )
        let data = try XCTUnwrap(out.data(using: .utf8))
        let document = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let content = try XCTUnwrap(document["content"] as? [[String: Any]])
        let attrs = try XCTUnwrap(content.first?["attrs"] as? [String: Any])
        let hydratedSource = try XCTUnwrap(attrs["src"] as? String)
        XCTAssertTrue(hydratedSource.hasPrefix("data:image/svg+xml"), hydratedSource)
        XCTAssertFalse(
            hydratedSource.contains("/api/v1/resources/\(testId)/blob"),
            "protected path must be rewritten before setContent"
        )
        let stale = await cache.fileURL(for: testId)
        try? FileManager.default.removeItem(at: stale)
    }

    func testIsProtectedResourceSourceMatchesAbsoluteAPIPath() {
        let base = URL(string: "https://demo.edgeever.org")!
        XCTAssertTrue(
            ResourceCache.isProtectedResourceSource(
                "https://other.example/api/v1/resources/abc/blob",
                baseURL: base
            )
        )
    }

    func testResourceSchemeLocalURLRoundTrip() {
        let url = EdgeEverResourceSchemeHandler.localURL(for: "memo_abc-1")
        XCTAssertEqual(url, "edgeever-res://local/memo_abc-1")
        XCTAssertEqual(
            EdgeEverResourceSchemeHandler.resourceId(from: URL(string: url)!),
            "memo_abc-1"
        )
    }

    func testResourceSchemeHandlerServesCachedPNG() async throws {
        // 1x1 transparent PNG
        let png = Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )!
        let id = "scheme-handler-test-\(UUID().uuidString)"
        await ResourceBlobStore.shared.put(id: id, data: png, mimeType: "image/png")

        let handler = EdgeEverResourceSchemeHandler()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(handler, forURLScheme: EdgeEverResourceSchemeHandler.scheme)
        let webView = await MainActor.run {
            WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: config)
        }
        let local = EdgeEverResourceSchemeHandler.localURL(for: id)
        let html = """
        <!DOCTYPE html><html><body>
        <img id="i" src="\(local)" width="1" height="1">
        <script>
          const img = document.getElementById('i');
          img.onload = () => window.webkit?.messageHandlers?.edgeever?.postMessage?.({ok:true,w:img.naturalWidth});
          img.onerror = () => window.webkit?.messageHandlers?.edgeever?.postMessage?.({ok:false});
          // Fallback resolve if already complete
          if (img.complete && img.naturalWidth > 0) {
            window.webkit?.messageHandlers?.edgeever?.postMessage?.({ok:true,w:img.naturalWidth});
          }
        </script>
        </body></html>
        """
        // Use navigation + evaluate after load instead of message handler for simplicity.
        let exp = expectation(description: "image loads via edgeever-res scheme")
        final class Nav: NSObject, WKNavigationDelegate {
            var onFinish: (() -> Void)?
            func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
                onFinish?()
            }
        }
        let nav = Nav()
        await MainActor.run {
            webView.navigationDelegate = nav
            nav.onFinish = { exp.fulfill() }
            webView.loadHTMLString(html, baseURL: URL(string: "https://edgeever.local/"))
        }
        await fulfillment(of: [exp], timeout: 5)
        // Poll naturalWidth via JS (give the scheme handler a moment if needed).
        var width = 0
        for _ in 0 ..< 20 {
            let result: Any? = await withCheckedContinuation { cont in
                DispatchQueue.main.async {
                    webView.evaluateJavaScript("document.getElementById('i').naturalWidth") { value, _ in
                        cont.resume(returning: value)
                    }
                }
            }
            width = (result as? Int) ?? (result as? Double).map { Int($0) } ?? 0
            if width > 0 { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(width, 1, "edgeever-res scheme should serve PNG so img.naturalWidth==1")
        await ResourceBlobStore.shared.remove(id: id)
    }

    func testListMemosFilterPinnedUsesShippedRepository() throws {
        let db = try AppDatabase.makeEmpty()
        let mirror = LocalMirrorRepository(dbQueue: db)
        let scope = "https://demo|user"
        let now = EdgeEverDate.nowString()
        var pinned = MemoDetail.localPlaceholder(
            id: "p1", notebookId: "nb", title: "Pinned", contentMarkdown: "x", tags: [], createdAt: now
        )
        pinned.isPinned = true
        let plain = MemoDetail.localPlaceholder(
            id: "p2", notebookId: "nb", title: "Plain", contentMarkdown: "y", tags: ["t"], createdAt: now
        )
        try mirror.applyBootstrapBatch(
            scope: scope,
            notebooks: [makeNotebook(id: "nb", parent: nil, name: "N", order: 0)],
            memos: [pinned, plain]
        )
        let pinnedOnly = try mirror.listMemos(
            scope: scope,
            params: LocalMemoListParams(filter: .pinned)
        )
        XCTAssertEqual(pinnedOnly.memos.map(\.id), ["p1"])
        let tagged = try mirror.listMemos(
            scope: scope,
            params: LocalMemoListParams(filter: .tagged)
        )
        XCTAssertEqual(tagged.memos.map(\.id), ["p2"])
    }

    private func makeNotebook(id: String, parent: String?, name: String, order: Int) -> Notebook {
        Notebook(
            id: id,
            parentId: parent,
            name: name,
            slug: nil,
            icon: nil,
            color: nil,
            sortOrder: order,
            memoCount: 0,
            lastMemoUpdatedAt: nil,
            createdAt: EdgeEverDate.nowString(),
            updatedAt: EdgeEverDate.nowString()
        )
    }
}
