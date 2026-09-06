import WebKit
import XCTest
@testable import EdgeEver

final class TipTapContentSourceTests: XCTestCase {
    func testViewerPrefersMarkdownForVisualDiagramEnvelope() {
        let decision = TipTapContentSource.resolve(
            mode: .viewer,
            documentJSON: #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"legacy node list"}]}]}"#,
            markdown: "# legacy\n\n- node list\n\n<!-- edgeever-diagram-v1:abc -->"
        )
        XCTAssertFalse(decision.useJSON)
        XCTAssertTrue(decision.payload.contains("edgeever-diagram-v1"))
    }

    func testEditorMarkdownRemainsAuthoritativeForRichStructures() {
        let markdown = """
        1. first
           1. nested

        ```swift
        let value = 1
        ```
        """
        let json = """
        {"type":"doc","content":[{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"first"}]}]}]},{"type":"codeBlock","attrs":{"language":"swift"},"content":[{"type":"text","text":"let value = 1"}]}]}
        """

        XCTAssertEqual(
            EditorContentCodec.preferredMarkdown(
                editorMarkdown: markdown,
                documentJSON: json,
                fallback: ""
            ),
            markdown
        )
    }

    func testEditorMarkdownFallbackDoesNotReplaceExistingCompatibilityCopy() {
        let fallback = "| A | B |\n| --- | --- |\n| 1 | 2 |\n"
        let json = """
        {"type":"doc","content":[{"type":"table","content":[]}]}
        """

        XCTAssertEqual(
            EditorContentCodec.preferredMarkdown(
                editorMarkdown: nil,
                documentJSON: json,
                fallback: fallback
            ),
            fallback
        )
    }

    func testEmptyEditorMarkdownRemainsAuthoritative() {
        XCTAssertEqual(
            EditorContentCodec.preferredMarkdown(
                editorMarkdown: "",
                documentJSON: #"{"type":"doc","content":[]}"#,
                fallback: "previous content"
            ),
            ""
        )
    }

    /// Flattened JSON + rich markdown must NOT drive the detail viewer (regression).
    func testViewerAlwaysPrefersMarkdownWhenPresent() {
        let richMD = """
        ## Hello

        This is **bold** and a list:

        - one
        - two

        ```swift
        let x = 1
        ```
        """
        let flatJSON = """
        {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"## Hello This is **bold**"}]}]}
        """
        let d = TipTapContentSource.resolve(
            mode: .viewer,
            documentJSON: flatJSON,
            markdown: richMD
        )
        XCTAssertFalse(d.useJSON, "viewer must setMarkdown, not flattened JSON")
        XCTAssertEqual(d.payload, richMD)
        XCTAssertTrue(d.fingerprint.hasPrefix("md:"))
    }

    func testViewerFallsBackToJSONOnlyWhenMarkdownEmpty() {
        let json = """
        {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}
        """
        let d = TipTapContentSource.resolve(mode: .viewer, documentJSON: json, markdown: "  \n")
        XCTAssertTrue(d.useJSON)
        XCTAssertTrue(d.fingerprint.hasPrefix("json:"))
    }

    func testEditorPrefersMarkdownWhenStructurallyRicher() {
        let md = "# Title\n\n- a\n- b\n\n```\ncode\n```\n"
        let flat = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Title a b code\"}]}]}"
        let d = TipTapContentSource.resolve(mode: .editor, documentJSON: flat, markdown: md)
        XCTAssertFalse(d.useJSON)
    }

    func testEditorPrefersJSONForSimpleImageNotes() {
        let md = "hello\n\n![](/api/v1/resources/res_x/blob)\n"
        let json = """
        {"type":"doc","content":[
          {"type":"paragraph","content":[{"type":"text","text":"hello"}]},
          {"type":"image","attrs":{"src":"/api/v1/resources/res_x/blob","alt":""}}
        ]}
        """
        let d = TipTapContentSource.resolve(mode: .editor, documentJSON: json, markdown: md)
        // Image node in JSON scores structure; simple md shouldn't force markdown path.
        XCTAssertTrue(d.useJSON, "simple image+text notes should keep JSON for order fidelity")
    }

    func testEditorAndViewerRecoverMathMissingFromLegacyJSON() {
        let markdown = "Euler: $e^{i\\pi}+1=0$."
        let flatJSON = #"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Euler: $e^{i\\pi}+1=0$."}]}]}"#

        XCTAssertFalse(TipTapContentSource.resolve(mode: .editor, documentJSON: flatJSON, markdown: markdown).useJSON)
        XCTAssertFalse(TipTapContentSource.resolve(mode: .viewer, documentJSON: flatJSON, markdown: markdown).useJSON)
    }

    func testEditorRecoversTaskListMissingFromLegacyJSON() {
        let markdown = "- [ ] Pending\n- [x] Complete\n"
        let legacyJSON = #"{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Pending"}]}]}]}]}"#

        let decision = TipTapContentSource.resolve(mode: .editor, documentJSON: legacyJSON, markdown: markdown)
        XCTAssertFalse(decision.useJSON)
        XCTAssertEqual(decision.payload, markdown)
    }

    func testNativeMarkdownFallbackPreservesTaskState() {
        let json = #"{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Pending"}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Complete"}]}]}]}]}"#

        XCTAssertEqual(
            EditorContentCodec.markdownFromTipTapJSON(json),
            "- [ ] Pending\n\n- [x] Complete\n"
        )
    }

    /// Live WKWebView: packaged TipTap must turn Markdown into real DOM structure.
    @MainActor
    func testPackagedEditorSetMarkdownRendersHeadingsListsAndBold() async throws {
        guard let htmlURL = TipTapResourceLoader.packagedEditorHTMLURL() else {
            // Host app test target should embed EditorBundle; fail loudly if not.
            let alt = Bundle(for: TipTapContentSourceTests.self).url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "EditorBundle"
            )
            XCTAssertNotNil(alt, "EditorBundle missing from test host")
            throw XCTSkip("EditorBundle not in test host bundle — run against EdgeEver app target tests")
        }

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 800), configuration: config)
        let dir = htmlURL.deletingLastPathComponent()
        webView.loadFileURL(htmlURL, allowingReadAccessTo: dir)

        // Wait for EdgeEverEditor bridge.
        let ready = expectation(description: "editor ready")
        var attempts = 0
        func pollReady() {
            webView.evaluateJavaScript("!!window.EdgeEverEditor") { value, _ in
                if (value as? Bool) == true {
                    ready.fulfill()
                } else {
                    attempts += 1
                    if attempts > 80 {
                        ready.fulfill() // let assert fail below
                        return
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: pollReady)
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: pollReady)
        await fulfillment(of: [ready], timeout: 12)

        let hasEditor = try await evalBool(webView, "!!window.EdgeEverEditor")
        XCTAssertTrue(hasEditor, "EdgeEverEditor bridge must load")

        // Configure viewer and push markdown (same path detail page uses).
        _ = try await eval(webView, """
        window.EdgeEverEditor.configure({ mode: 'viewer', locale: 'zh-CN', theme: 'light' });
        true
        """)

        let sample = """
        ## 标题渲染

        这是 **粗体** 文本。

        - 列表一项
        - 列表二项

        ```js
        console.log(1)
        ```

        Euler: $e^{i\\pi}+1=0$.

        $$
        \\frac{a}{b}
        $$
        """
        let b64 = Data(sample.utf8).base64EncodedString()
        _ = try await eval(webView, """
        (function(){
          var bin = atob('\(b64)');
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          var md = new TextDecoder('utf-8').decode(bytes);
          window.EdgeEverEditor.setMarkdown(md);
          return true;
        })()
        """)

        // Give setContent + afterContentSet a beat.
        try await Task.sleep(nanoseconds: 400_000_000)

        let h2 = try await evalInt(webView, "document.querySelectorAll('h1,h2,h3').length")
        let strong = try await evalInt(webView, "document.querySelectorAll('strong,b').length")
        let li = try await evalInt(webView, "document.querySelectorAll('li').length")
        let pre = try await evalInt(webView, "document.querySelectorAll('pre').length")
        let math = try await evalInt(webView, "document.querySelectorAll('.tiptap-mathematics-render .katex').length")
        let rawLeak = try await evalBool(
            webView,
            "document.body.innerText.indexOf('## 标题渲染') >= 0 && document.querySelectorAll('h1,h2,h3').length === 0"
        )

        XCTAssertGreaterThanOrEqual(h2, 1, "heading must render as h1/h2/h3, not plain text")
        XCTAssertGreaterThanOrEqual(strong, 1, "bold markdown must render as strong/b")
        XCTAssertGreaterThanOrEqual(li, 2, "list items must render")
        XCTAssertGreaterThanOrEqual(pre, 1, "fenced code must render as pre")
        XCTAssertEqual(math, 2, "inline and block LaTeX must render through KaTeX")
        XCTAssertFalse(rawLeak, "must not show raw '## heading' as plain text without heading nodes")

        // Contrast: flattened JSON path must NOT be what viewer policy selects.
        let decision = TipTapContentSource.resolve(
            mode: .viewer,
            documentJSON: """
            {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"## 标题渲染 这是 **粗体**"}]}]}
            """,
            markdown: sample
        )
        XCTAssertFalse(decision.useJSON)
    }

    /// Live WKWebView regression for the portable projection of visual diagram notes.
    @MainActor
    func testPackagedViewerRendersAllVisualDiagramFallbacksAsSVG() async throws {
        let htmlURL = try XCTUnwrap(
            TipTapResourceLoader.packagedEditorHTMLURL(),
            "EditorBundle must be available in the native app test host"
        )
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 800), configuration: config)
        webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())

        for _ in 0..<100 {
            if try await evalBool(webView, "!!window.EdgeEverEditor") { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let editorReady = try await evalBool(webView, "!!window.EdgeEverEditor")
        XCTAssertTrue(editorReady)

        func envelope(_ json: String) -> String {
            let marker = Data(json.utf8).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            return "# legacy\n\n- node list only\n\n<!-- edgeever-diagram-v1:\(marker) -->"
        }
        let samples = [
            envelope(#"{"schemaVersion":1,"kind":"mind-map","nodes":[{"id":"a","label":"核心主题","x":0,"y":0,"width":100,"height":40,"shape":"topic"},{"id":"b","label":"分支主题","x":160,"y":0,"width":100,"height":40,"shape":"topic","parentId":"a"}],"edges":[{"id":"e","source":"a","target":"b"}]}"#),
            envelope(#"{"schemaVersion":1,"kind":"flowchart","nodes":[{"id":"a","label":"开始","x":0,"y":0,"width":100,"height":40,"shape":"terminator"},{"id":"b","label":"处理步骤","x":0,"y":100,"width":100,"height":40,"shape":"process"}],"edges":[{"id":"e","source":"a","target":"b"}]}"#),
            envelope(#"{"schemaVersion":2,"kind":"architecture","nodes":[{"id":"system","label":"应用系统","x":0,"y":0,"width":500,"height":300,"shape":"boundary"},{"id":"api","label":"API 服务","x":40,"y":40,"width":156,"height":64,"shape":"service","parentId":"system"},{"id":"db","label":"数据库","x":260,"y":40,"width":150,"height":72,"shape":"database","parentId":"system"}],"edges":[{"id":"query","source":"api","target":"db","label":"查询","kind":"data"}]}"#),
        ]

        for sample in samples {
            let b64 = Data(sample.utf8).base64EncodedString()
            _ = try await eval(webView, """
            (function(){
              window.EdgeEverEditor.configure({ mode: 'viewer', locale: 'zh-CN', theme: 'light' });
              var bin = atob('\(b64)');
              var bytes = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              window.EdgeEverEditor.setMarkdown(new TextDecoder('utf-8').decode(bytes));
              return true;
            })()
            """)

            var svgCount = 0
            for _ in 0..<100 {
                svgCount = try await evalInt(webView, "document.querySelectorAll('.edgeever-mermaid svg').length")
                if svgCount == 1 { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            XCTAssertEqual(svgCount, 1, "each visual-note envelope must render as SVG in the iOS viewer")
            let leakedLegacyFallback = try await evalBool(webView, "document.body.innerText.includes('node list only')")
            XCTAssertFalse(leakedLegacyFallback)
        }
    }

    // MARK: - JS helpers

    @MainActor
    private func eval(_ webView: WKWebView, _ js: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { cont in
            webView.evaluateJavaScript(js) { value, error in
                if let error { cont.resume(throwing: error) }
                else { cont.resume(returning: value) }
            }
        }
    }

    @MainActor
    private func evalBool(_ webView: WKWebView, _ js: String) async throws -> Bool {
        let v = try await eval(webView, js)
        if let b = v as? Bool { return b }
        if let n = v as? NSNumber { return n.boolValue }
        return false
    }

    @MainActor
    private func evalInt(_ webView: WKWebView, _ js: String) async throws -> Int {
        let v = try await eval(webView, js)
        if let i = v as? Int { return i }
        if let n = v as? NSNumber { return n.intValue }
        if let d = v as? Double { return Int(d) }
        return 0
    }
}
