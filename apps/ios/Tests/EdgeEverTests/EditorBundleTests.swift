import XCTest
import WebKit
@testable import EdgeEver

/// Ensures the TipTap editor HTML is actually shipped in the app (not the plain-text fallback).
final class EditorBundleTests: XCTestCase {
    @MainActor
    func testNativeImageBatchCreatesAnEditableGallery() async throws {
        let url = try XCTUnwrap(TipTapWebView.Coordinator.packagedEditorHTMLURL())
        let loaded = expectation(description: "editor bridge ready")
        final class Loader: NSObject, WKScriptMessageHandler {
            let loaded: XCTestExpectation
            init(_ loaded: XCTestExpectation) { self.loaded = loaded }
            func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
                if (message.body as? [String: Any])?["type"] as? String == "ready" { loaded.fulfill() }
            }
        }
        let loader = Loader(loaded)
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.userContentController.add(loader, name: "edgeever")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        await fulfillment(of: [loaded], timeout: 30)
        let result = try await webView.evaluateJavaScript("""
        (() => {
          const api = window.EdgeEverEditor;
          api.configure({mode:'editor', locale:'en-US'});
          api.setDocumentFromJSON(JSON.stringify({type:'doc',content:[{type:'paragraph'}]}));
          const images = ['green','red','blue'].map(color => 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="' + color + '"/></svg>'));
          images.forEach((src, i) => api.completeImageUpload('test-' + i, src, 'photo-' + i));
          const grouped = api.groupImages(images);
          const toolbar = document.querySelector('.edgeever-native-gallery-toolbar');
          toolbar?.querySelectorAll('button')[3].click();
          const doc = JSON.parse(api.getDocument());
          const gallery = doc.content.find(node => node.type === 'edgeeverImageGallery');
          const controlsHidden = [...document.querySelectorAll('.edgeever-native-gallery-content .edgeever-image-size-controls')]
            .every(node => getComputedStyle(node).display === 'none');
          api.configure({mode:'viewer', locale:'en-US'});
          return { grouped, layout:gallery?.attrs.layout, sources:gallery?.content.map(node => node.attrs.src),
            orderPreserved:JSON.stringify(gallery?.content.map(node => node.attrs.src)) === JSON.stringify(images),
            controlsHidden, viewerToolbarHidden:toolbar?.hidden };
        })()
        """) as? [String: Any]
        XCTAssertEqual(result?["grouped"] as? Bool, true)
        XCTAssertEqual(result?["layout"] as? String, "1")
        XCTAssertEqual((result?["sources"] as? [String])?.count, 3)
        XCTAssertEqual(result?["orderPreserved"] as? Bool, true)
        XCTAssertEqual(result?["controlsHidden"] as? Bool, true)
        XCTAssertEqual(result?["viewerToolbarHidden"] as? Bool, true)
        config.userContentController.removeScriptMessageHandler(forName: "edgeever")
    }

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

    func testPackagedViewerExposesDoubleTapEditBridge() throws {
        let url = try XCTUnwrap(TipTapWebView.Coordinator.packagedEditorHTMLURL())
        let html = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(
            html.contains("doubleTap"),
            "viewer body must expose the double-tap edit bridge"
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
