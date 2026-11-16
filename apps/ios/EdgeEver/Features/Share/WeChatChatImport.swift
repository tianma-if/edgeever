import Foundation

enum WeChatChatImport {
    static func save(_ archive: WeChatChatArchive, notebookID: String, client: APIClient) async throws -> MemoDetail {
        let title = String(archive.title.prefix(160))
        let memo = try await client.createMemo(
            notebookId: notebookID, title: title,
            contentMarkdown: archive.attachments.isEmpty ? archive.markdown : "", tags: []
        )
        guard !archive.attachments.isEmpty else { return memo }

        do {
            var urls: [String: String] = [:]
            for attachment in archive.attachments {
                let resource = try await client.uploadMemoResource(
                    memoId: memo.id, filename: attachment.filename,
                    mimeType: attachment.mimeType, fileURL: attachment.data
                )
                urls[attachment.id] = resource.url
            }
            let editSession = try await client.createMemoEditSession(memoId: memo.id)
            return try await client.updateMemo(
                id: memo.id, expectedRevision: memo.revision, expectedContentHash: memo.contentHash,
                editSessionId: editSession.id, notebookId: nil, title: nil, isPinned: nil,
                contentMarkdown: try attachmentLinks(in: archive.markdown, urls: urls), tags: nil
            )
        } catch {
            do {
                try await client.deleteMemo(id: memo.id)
                try await client.deleteMemo(id: memo.id, permanent: true)
            } catch {
                throw WeChatArchiveError.incompleteMemo
            }
            throw error
        }
    }

    private static func attachmentLinks(in markdown: String, urls: [String: String]) throws -> String {
        let pattern = try NSRegularExpression(pattern: #"edgeever-wechat-media://(m\d+)(?=\))"#)
        let updated = NSMutableString(string: markdown)
        let matches = pattern.matches(in: markdown, range: NSRange(markdown.startIndex..., in: markdown))
        for match in matches.reversed() {
            if let id = Range(match.range(at: 1), in: markdown), let url = urls[String(markdown[id])] {
                updated.replaceCharacters(in: match.range, with: url)
            }
        }
        return updated as String
    }
}
