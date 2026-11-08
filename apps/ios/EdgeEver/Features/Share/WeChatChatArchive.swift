import Foundation
import JavaScriptCore
import ZIPFoundation

struct WeChatChatArchive: Sendable {
    private static let expandedLimit: UInt64 = 256 * 1_024 * 1_024
    private static let transcriptLimit: UInt64 = 1_024 * 1_024

    struct Attachment: Decodable, Sendable {
        let id: String
        let filename: String
        let mimeType: String
        let data: URL
    }

    private struct Rendered: Decodable, Sendable {
        let title: String
        let markdown: String
        let media: [Attachment]
    }

    let title: String
    let markdown: String
    let attachments: [Attachment]
    let temporaryDirectory: URL

    static func prepare(_ source: URL, formatterURL: URL) throws -> WeChatChatArchive {
        let fileManager = FileManager.default
        let temporaryRoot = fileManager.temporaryDirectory
        let temporaryDirectory = temporaryRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let rendered = try WeChatShareInbox.withStorageErrors {
            let count = try WeChatZipDirectory.checkedEntryCount(in: source)
            let archive = try Archive(url: source, accessMode: .read)
            var files: [(entry: Entry, path: String)] = []
            var paths = Set<String>()
            var expanded: UInt64 = 0
            for entry in archive {
                // WeChat writes UTF-8 names even when the ZIP UTF-8 flag is absent.
                let path = entry.path(using: .utf8)
                guard paths.count < count, paths.insert(path).inserted, entry.type != .symlink,
                      safePath(path, isDirectory: entry.type == .directory)
                else { throw WeChatArchiveError.invalidArchive }
                guard entry.uncompressedSize <= expandedLimit - expanded else {
                    throw WeChatArchiveError.expansionLimit
                }
                expanded += entry.uncompressedSize
                if entry.type == .file && isChatFile(path) { files.append((entry, path)) }
            }
            guard paths.count == count, let transcript = files.first(where: { basename($0.path) == "聊天记录.txt" }),
                  (1...transcriptLimit).contains(transcript.entry.uncompressedSize)
            else { throw WeChatArchiveError.invalidArchive }

            var text = Data()
            try extract(transcript.entry, from: archive) { text.append($0) }
            guard let transcriptText = String(data: text, encoding: .utf8),
                  !transcriptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { throw WeChatArchiveError.invalidArchive }

            let media = files.filter { $0.path != transcript.path && $0.entry.uncompressedSize > 0 }
            try WeChatShareInbox.requireSpace(media.reduce(0) { $0 + $1.entry.uncompressedSize }, at: temporaryRoot)
            try fileManager.createDirectory(at: temporaryDirectory, withIntermediateDirectories: false)
            do {
                let entries = try media.enumerated().map { index, mediaFile -> [String: String] in
                    let (entry, path) = mediaFile
                    let folder = temporaryDirectory.appendingPathComponent(String(index), isDirectory: true)
                    try fileManager.createDirectory(at: folder, withIntermediateDirectories: false)
                    let destination = folder.appendingPathComponent(basename(path), isDirectory: false)
                    guard fileManager.createFile(atPath: destination.path, contents: nil) else {
                        try WeChatShareInbox.requireSpace(entry.uncompressedSize, at: temporaryRoot)
                        throw CocoaError(.fileWriteUnknown)
                    }
                    let output = try FileHandle(forWritingTo: destination)
                    defer { try? output.close() }
                    try extract(entry, from: archive) { chunk in
                        try WeChatShareInbox.requireSpace(UInt64(chunk.count), at: temporaryRoot)
                        try output.write(contentsOf: chunk)
                    }
                    return ["name": path, "data": destination.absoluteString]
                }
                return try render(transcriptText, filename: source.lastPathComponent, entries: entries, script: formatterURL)
            } catch {
                try? fileManager.removeItem(at: temporaryDirectory)
                throw error
            }
        }
        return WeChatChatArchive(
            title: rendered.title, markdown: rendered.markdown,
            attachments: rendered.media, temporaryDirectory: temporaryDirectory
        )
    }

    private static func safePath(_ path: String, isDirectory: Bool) -> Bool {
        guard !path.contains("\\"), !path.contains("\0") else { return false }
        let name = isDirectory && path.hasSuffix("/") ? String(path.dropLast()) : path
        return !name.isEmpty && name.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
            !$0.isEmpty && $0 != "." && $0 != ".."
        }
    }

    private static func basename(_ path: String) -> String {
        path.split(separator: "/").last.map(String.init) ?? ""
    }

    private static func isChatFile(_ path: String) -> Bool {
        let name = basename(path)
        return name != ".DS_Store" && !name.hasPrefix("._") && !path.hasPrefix("__MACOSX/")
    }

    private static func extract(_ entry: Entry, from archive: Archive, consume: (Data) throws -> Void) throws {
        var actual: UInt64 = 0
        let checksum = try archive.extract(entry, bufferSize: 256 * 1_024) { chunk in
            guard UInt64(chunk.count) <= entry.uncompressedSize - actual else {
                throw WeChatArchiveError.invalidArchive
            }
            actual += UInt64(chunk.count)
            try consume(chunk)
        }
        guard actual == entry.uncompressedSize, checksum == entry.checksum else {
            throw WeChatArchiveError.invalidArchive
        }
    }

    private static func render(
        _ transcript: String, filename: String, entries: [[String: String]], script: URL
    ) throws -> Rendered {
        guard let context = JSContext() else { throw WeChatArchiveError.invalidArchive }
        context.evaluateScript("globalThis.exports = {};")
        let source = try String(contentsOf: script, encoding: .utf8)
        context.evaluateScript(source, withSourceURL: script)
        guard let formatter = context.objectForKeyedSubscript("exports")?.objectForKeyedSubscript("renderWeChatChat"),
              let value = formatter.call(withArguments: [transcript, filename, entries]), !value.isNull,
              let json = context.objectForKeyedSubscript("JSON")?.invokeMethod("stringify", withArguments: [value]),
              let bytes = json.toString()?.data(using: .utf8), context.exception == nil
        else { throw WeChatArchiveError.invalidArchive }
        return try JSONDecoder().decode(Rendered.self, from: bytes)
    }
}
