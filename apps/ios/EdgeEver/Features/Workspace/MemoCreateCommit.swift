import Foundation

/// Shipped create-Done path for `MemoEditView` (Android `createMutation` parity).
///
/// After image upload, `materializeForImage` already creates a **server** memo and sets
/// `memoId`. Done must **update** that memo — never mint a second `local:` + create.
enum MemoCreateCommit {
    enum Outcome: Equatable, Sendable {
        case createdLocal(memoId: String)
        case updatedMaterialized(memoId: String)
    }

    /// Server id from materialize (not offline `local:` placeholder).
    static func isMaterializedServerId(_ memoId: String?) -> Bool {
        guard let memoId else { return false }
        let trimmed = memoId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return !trimmed.hasPrefix("local:")
    }

    /// Commit create modal content.
    /// - If `memoId` is a materialized server id → optimistic mirror update + outbox update.
    /// - Else → offline-first `local:` create + outbox create (Android temporaryId path).
    @discardableResult
    static func commit(
        scope: String,
        memoId: String?,
        expectedRevision: Int?,
        expectedContentHash: String?,
        notebookId: String,
        title: String,
        untitledTitle: String = "无标题笔记",
        contentMarkdown: String,
        contentJSON: String?,
        tags: [String],
        mirror: LocalMirrorRepository,
        outbox: SyncOutboxRepository,
        drafts: DraftRepository,
        now: String = EdgeEverDate.nowString()
    ) throws -> Outcome {
        guard !notebookId.isEmpty else {
            throw APIError(status: 400, code: nil, message: "请选择笔记本")
        }
        let displayTitle = title.isEmpty ? untitledTitle : title

        if isMaterializedServerId(memoId), let serverId = memoId {
            guard var memo = try mirror.resolveMemo(scope: scope, id: serverId) else {
                // Mirror miss: still queue update against known server id (Android upserts optimistic).
                var placeholder = MemoDetail.localPlaceholder(
                    id: serverId,
                    notebookId: notebookId,
                    title: displayTitle,
                    contentMarkdown: contentMarkdown,
                    tags: tags,
                    createdAt: now
                )
                placeholder.revision = expectedRevision ?? 0
                placeholder.contentHash = expectedContentHash ?? "local:\(serverId)"
                if let contentJSON, let json = try? JSONValue.parse(contentJSON) {
                    placeholder.contentJson = json
                }
                try mirror.upsertMemo(scope: scope, memo: placeholder)
                try outbox.enqueueUpdate(
                    scope: scope,
                    payload: MemoUpdatePayload(
                        memoId: serverId,
                        expectedRevision: expectedRevision ?? 0,
                        expectedContentHash: expectedContentHash ?? placeholder.contentHash,
                        title: displayTitle,
                        contentMarkdown: contentMarkdown,
                        contentJson: contentJSON,
                        notebookId: notebookId,
                        tags: tags
                    )
                )
                try drafts.clear(scope: scope, key: DraftRepository.newKey)
                try? drafts.clear(scope: scope, key: DraftRepository.memoKey(serverId))
                return .updatedMaterialized(memoId: serverId)
            }

            // Use mirror base (server tip). Stale caller expectedRevision causes 409 conflicts.
            let rev = memo.revision
            let hash = memo.contentHash
            memo.title = displayTitle
            memo.contentMarkdown = contentMarkdown
            memo.contentText = contentMarkdown
            memo.tags = tags
            memo.notebookId = notebookId
            memo.updatedAt = now
            memo.excerpt = String(contentMarkdown.prefix(160))
            if let contentJSON, let json = try? JSONValue.parse(contentJSON) {
                memo.contentJson = json
            }
            try mirror.upsertMemo(scope: scope, memo: memo)

            try outbox.enqueueUpdate(
                scope: scope,
                payload: MemoUpdatePayload(
                    memoId: memo.id,
                    expectedRevision: rev,
                    expectedContentHash: hash,
                    title: displayTitle,
                    contentMarkdown: contentMarkdown,
                    contentJson: contentJSON,
                    notebookId: notebookId,
                    tags: tags
                )
            )
            try drafts.clear(scope: scope, key: DraftRepository.newKey)
            try? drafts.clear(scope: scope, key: DraftRepository.memoKey(serverId))
            return .updatedMaterialized(memoId: serverId)
        }

        let localId = "local:\(UUID().uuidString.lowercased())"
        var placeholder = MemoDetail.localPlaceholder(
            id: localId,
            notebookId: notebookId,
            title: title,
            contentMarkdown: contentMarkdown,
            tags: tags,
            createdAt: now
        )
        // Persist TipTap JSON so image width attrs survive into detail/viewer.
        if let contentJSON, let json = try? JSONValue.parse(contentJSON) {
            placeholder.contentJson = json
        }
        try mirror.upsertMemo(scope: scope, memo: placeholder)
        try outbox.enqueueCreate(
            scope: scope,
            payload: MemoCreatePayload(
                memoId: localId,
                title: displayTitle,
                contentMarkdown: contentMarkdown,
                contentJson: contentJSON,
                notebookId: notebookId,
                tags: tags,
                createdAt: now
            )
        )
        try drafts.clear(scope: scope, key: DraftRepository.newKey)
        return .createdLocal(memoId: localId)
    }
}
