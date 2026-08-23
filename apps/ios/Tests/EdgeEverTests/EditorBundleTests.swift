import XCTest
@testable import EdgeEver

/// Ensures the TipTap editor HTML is actually shipped in the app (not the plain-text fallback).
final class EditorBundleTests: XCTestCase {
    func testPackagedEditorHTMLIsPresentAndLarge() throws {
        let url = TipTapWebView.Coordinator.packagedEditorHTMLURL()
        XCTAssertNotNil(url, "EditorBundle/index.html must be in the app bundle so Markdown renders")
        let data = try Data(contentsOf: try XCTUnwrap(url))
        // Real Vite TipTap bundle is multi-MB; fallback stub is a few KB.
        XCTAssertGreaterThan(data.count, 100_000, "packaged editor is too small — likely missing TipTap build")
        let head = String(data: data.prefix(800), encoding: .utf8) ?? ""
        XCTAssertTrue(
            head.contains("EdgeEver") || head.contains("tiptap") || head.contains("module"),
            "expected TipTap editor HTML, got: \(head.prefix(120))"
        )
    }

    func testPackagedEditorIsNotPlainFallbackStub() throws {
        let url = try XCTUnwrap(TipTapWebView.Coordinator.packagedEditorHTMLURL())
        let html = try String(contentsOf: url, encoding: .utf8)
        // Fallback embeds a tiny mdToHtml with contenteditable div only.
        XCTAssertFalse(html.contains("Minimal contenteditable"), "must not ship the Swift fallback HTML")
        XCTAssertTrue(
            html.contains("EdgeEverEditor") || html.contains("setMarkdown"),
            "TipTap bridge API should be present"
        )
    }

    func testAiSelectionReplacementKeepsInlineContentInItsParagraph() throws {
        let url = try XCTUnwrap(TipTapWebView.Coordinator.packagedEditorHTMLURL())
        let html = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(
            html.contains("edgeever-inline-sentinel"),
            "selected-text AI replacement must preserve the surrounding paragraph"
        )
    }

    func testPackagedEditorExposesChunkedImageExportBridge() throws {
        let url = try XCTUnwrap(TipTapWebView.Coordinator.packagedEditorHTMLURL())
        let html = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(html.contains("exportImage"), "TipTap bridge must expose note image export")
        XCTAssertTrue(
            html.contains("imageExportComplete") && html.contains("imageExportChunk"),
            "large image exports must cross the native bridge in bounded chunks"
        )
        XCTAssertTrue(
            html.contains("failedImages") && html.contains("totalImages"),
            "image export completion must report note-image failures for preview feedback"
        )
    }

    /// Caret must not be forced to document end on every content set / keystroke path.
    func testNativeBridgeDoesNotForceCaretToEndOnPush() throws {
        // Tests/EdgeEverTests/ThisFile.swift → apps/ios/
        let iosRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // EdgeEverTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // ios
        let webView = try String(
            contentsOf: iosRoot.appendingPathComponent("EdgeEver/Editor/TipTapWebView.swift"),
            encoding: .utf8
        )
        let runtime = try String(
            contentsOf: iosRoot.appendingPathComponent("EdgeEver/Editor/TipTapWarmPool.swift"),
            encoding: .utf8
        )
        // SwiftUI surface must not force caret; runtime owns open-edit focus once.
        XCTAssertFalse(
            webView.contains("focusEnd()"),
            "TipTapWebView must not call focusEnd() — jumps caret to bottom while editing"
        )
        XCTAssertTrue(
            runtime.contains("lastEditorEmittedFingerprint"),
            "must ignore editor-originated updates so typing does not re-setContent"
        )
        XCTAssertTrue(
            runtime.contains("needsForcePushOnBind"),
            "detach must force next bind to re-push so create does not keep previous body"
        )
        // Viewer detail must prefer Markdown (setMarkdown), not flattened contentJson.
        XCTAssertTrue(
            runtime.contains("TipTapContentSource.resolve") || runtime.contains("contentDecision"),
            "runtime must route content through TipTapContentSource policy"
        )
    }
}
