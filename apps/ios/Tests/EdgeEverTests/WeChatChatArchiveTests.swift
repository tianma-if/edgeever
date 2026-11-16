import XCTest
import ZIPFoundation
@testable import EdgeEver

final class WeChatChatArchiveTests: XCTestCase {
    func testShareInboxStagesAnArchiveAndRendersItsAttachmentsInOrder() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("fixture.zip")
        try makeArchive(at: source, attachmentPath: "聊天记录内的图片、视频和文件/图.jpg")
        try clearUTF8Flags(at: source)
        let inbox = root.appendingPathComponent("inbox", isDirectory: true)
        try WeChatShareInbox.stage(source, suggestedName: "聊天记录.zip", in: inbox)

        let item = try XCTUnwrap(WeChatShareInbox.next(in: inbox))
        let archive = try WeChatChatArchive.prepare(item.archiveURL, formatterURL: formatterURL())
        defer { try? FileManager.default.removeItem(at: archive.temporaryDirectory) }
        XCTAssertEqual(archive.title, "聊天记录 · 2026-09-22 22:15")
        XCTAssertTrue(archive.markdown.contains("**小明**"))
        XCTAssertTrue(archive.markdown.contains("![图.jpg](edgeever-wechat-media://m1)"))
        let attachment = try XCTUnwrap(archive.attachments.first)
        XCTAssertEqual(attachment.filename, "图.jpg")
        XCTAssertEqual(try Data(contentsOf: attachment.data), Data("fixture".utf8))
    }

    func testRejectsTraversalAndReportsInsufficientStorage() throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("fixture.zip")
        try makeArchive(at: source, attachmentPath: "../图.jpg")
        XCTAssertThrowsError(try WeChatChatArchive.prepare(source, formatterURL: formatterURL()))
        XCTAssertThrowsError(try WeChatShareInbox.requireSpace(.max, at: root)) { error in
            guard case WeChatArchiveError.insufficientSpace = error else {
                return XCTFail("Expected insufficient storage, got \(error)")
            }
        }
    }

    private func makeArchive(at url: URL, attachmentPath: String) throws {
        let archive = try Archive(url: url, accessMode: .create)
        let transcript = "·小明\n2026年9月22日 22:15\n你好\n[图片] 图.jpg"
        for (path, text) in [("聊天记录.txt", transcript), (attachmentPath, "fixture")] {
            let data = Data(text.utf8)
            try archive.addEntry(with: path, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .deflate) {
                position, size in
                data.subdata(in: Int(position)..<(Int(position) + size))
            }
        }
    }

    private func clearUTF8Flags(at url: URL) throws {
        var data = try Data(contentsOf: url)
        for index in 0..<(data.count - 10) where data[index] == 0x50 && data[index + 1] == 0x4b {
            switch (data[index + 2], data[index + 3]) {
            case (0x03, 0x04): data[index + 7] &= ~0x08
            case (0x01, 0x02): data[index + 9] &= ~0x08
            default: break
            }
        }
        try data.write(to: url)
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        return url
    }

    private func formatterURL() throws -> URL {
        try XCTUnwrap(Bundle.main.url(forResource: "wechat-chat-transcript", withExtension: "cjs"))
    }
}
