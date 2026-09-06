import Foundation
import GRDB

struct LocalMemoListParams: Sendable {
    var notebookId: String? = nil
    var notebookIds: [String]? = nil
    var q: String? = nil
    var trash: Bool = false
    var sort: MemoSortMode = .updatedDesc
    var filter: MemoFilterMode = .all
    var limit: Int = 50
    var offset: Int = 0
}

struct LocalMemoListResult: Sendable {
    var memos: [MemoSummary]
    var totalCount: Int
    var nextOffset: Int?
}

final class LocalMirrorRepository: @unchecked Sendable {
    private let dbQueue: DatabaseQueue

    init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    func isInitialized(scope: String) throws -> Bool {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT key, value FROM mobile_sync_meta WHERE scope = ? AND key IN ('cursor', 'identity')",
                arguments: [scope]
            )
            var cursor: String?
            var identity: String?
            for row in rows {
                let key: String = row["key"]
                let value: String = row["value"]
                if key == "cursor" { cursor = value }
                if key == "identity" { identity = value }
            }
            return SyncProtocol.isMetadataInitialized(cursorValue: cursor, identityValue: identity)
        }
    }

    func listNotebooks(scope: String) throws -> [Notebook] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: """
                SELECT n.data_json,
                       COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
                       MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
                FROM mobile_notebooks n
                LEFT JOIN mobile_memos m ON m.scope = n.scope AND m.notebook_id = n.id
                WHERE n.scope = ?
                GROUP BY n.id, n.data_json
                ORDER BY n.sort_order ASC, n.name COLLATE NOCASE ASC
                """,
                arguments: [scope]
            )
            return try rows.map { row in
                var notebook = try EdgeEverJSON.decoder.decode(Notebook.self, from: Data((row["data_json"] as String).utf8))
                notebook.memoCount = row["memo_count"]
                notebook.lastMemoUpdatedAt = row["last_memo_updated_at"]
                return notebook
            }
        }
    }

    func listTags(scope: String) throws -> [TagSummary] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT data_json FROM mobile_memos WHERE scope = ? AND is_deleted = 0",
                arguments: [scope]
            )
            var summaries: [String: (memoCount: Int, updatedAt: String?)] = [:]
            for row in rows {
                let raw = row["data_json"] as String
                guard let memo = try? EdgeEverJSON.decoder.decode(MemoDetail.self, from: Data(raw.utf8)) else { continue }
                for name in Set(memo.tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }).filter({ !$0.isEmpty }) {
                    var summary = summaries[name] ?? (memoCount: 0, updatedAt: nil)
                    summary.memoCount += 1
                    if summary.updatedAt == nil || memo.updatedAt > summary.updatedAt! {
                        summary.updatedAt = memo.updatedAt
                    }
                    summaries[name] = summary
                }
            }
            return summaries
                .map { TagSummary(name: $0.key, memoCount: $0.value.memoCount, updatedAt: $0.value.updatedAt) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
    }

    func listMemos(scope: String, params: LocalMemoListParams) throws -> LocalMemoListResult {
        try dbQueue.read { db in
            var conditions = ["scope = ?", "is_deleted = ?"]
            var arguments: [any DatabaseValueConvertible] = [scope, params.trash ? 1 : 0]

            if let notebookIds = params.notebookIds, !notebookIds.isEmpty {
                conditions.append("notebook_id IN (\(notebookIds.map { _ in "?" }.joined(separator: ",")))")
                arguments.append(contentsOf: notebookIds)
            } else if let notebookId = params.notebookId {
                conditions.append("notebook_id = ?")
                arguments.append(notebookId)
            }
            if let q = params.q?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty {
                conditions.append("(title LIKE ? OR content_text LIKE ? OR tags_text LIKE ?)")
                let pattern = "%\(q)%"
                arguments.append(contentsOf: [pattern, pattern, pattern])
            }
            switch params.filter {
            case .all: break
            case .tagged: conditions.append("tags_text <> ''")
            case .untagged: conditions.append("tags_text = ''")
            case .pinned: conditions.append("is_pinned = 1")
            }

            let orderBy: String
            if params.trash {
                orderBy = "deleted_at DESC, id DESC"
            } else {
                switch params.sort {
                case .createdDesc: orderBy = "is_pinned DESC, created_at DESC, id DESC"
                case .titleAsc: orderBy = "is_pinned DESC, title COLLATE NOCASE ASC, updated_at DESC, id DESC"
                case .updatedDesc: orderBy = "is_pinned DESC, updated_at DESC, id DESC"
                }
            }

            let whereSQL = conditions.joined(separator: " AND ")
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM mobile_memos WHERE \(whereSQL)", arguments: StatementArguments(arguments)) ?? 0
            let limit = params.limit
            let offset = max(0, params.offset)
            var listArgs = arguments
            listArgs.append(limit)
            listArgs.append(offset)
            let rows = try Row.fetchAll(
                db,
                sql: "SELECT data_json FROM mobile_memos WHERE \(whereSQL) ORDER BY \(orderBy) LIMIT ? OFFSET ?",
                arguments: StatementArguments(listArgs)
            )
            // Skip corrupt rows instead of failing the entire list (one bad data_json must not blank the feed).
            var memos: [MemoSummary] = []
            memos.reserveCapacity(rows.count)
            for row in rows {
                let raw = row["data_json"] as String
                guard let detail = try? EdgeEverJSON.decoder.decode(MemoDetail.self, from: Data(raw.utf8)) else {
                    #if DEBUG
                    print("LocalMirrorRepository.listMemos: skipped undecodable memo json length=\(raw.count)")
                    #endif
                    continue
                }
                memos.append(detail.asSummary())
            }
            let next = offset + rows.count
            return LocalMemoListResult(memos: memos, totalCount: count, nextOffset: next < count ? next : nil)
        }
    }

    func getMemo(scope: String, id: String) throws -> MemoDetail? {
        try dbQueue.read { db in
            guard let json = try String.fetchOne(
                db,
                sql: "SELECT data_json FROM mobile_memos WHERE scope = ? AND id = ?",
                arguments: [scope, id]
            ) else { return nil }
            return try EdgeEverJSON.decoder.decode(MemoDetail.self, from: Data(json.utf8))
        }
    }

    func resolveMemo(scope: String, id: String) throws -> MemoDetail? {
        if let direct = try getMemo(scope: scope, id: id) { return direct }
        return try dbQueue.read { db in
            guard let remoteId = try String.fetchOne(
                db,
                sql: "SELECT remote_id FROM mobile_id_mappings WHERE scope = ? AND temporary_id = ?",
                arguments: [scope, id]
            ) else { return nil }
            guard let json = try String.fetchOne(
                db,
                sql: "SELECT data_json FROM mobile_memos WHERE scope = ? AND id = ?",
                arguments: [scope, remoteId]
            ) else { return nil }
            return try EdgeEverJSON.decoder.decode(MemoDetail.self, from: Data(json.utf8))
        }
    }

    func upsertMemo(scope: String, memo: MemoDetail) throws {
        try dbQueue.write { db in
            try upsertMemo(db, scope: scope, memo: memo)
        }
    }

    func softDeleteMemo(scope: String, id: String) throws -> Bool {
        guard var memo = try getMemo(scope: scope, id: id), !memo.isDeleted else { return false }
        let now = ISO8601DateFormatter.edgeEver.string(from: Date())
        memo.isDeleted = true
        memo.deletedAt = now
        memo.updatedAt = now
        try upsertMemo(scope: scope, memo: memo)
        return true
    }

    func deleteMemo(scope: String, id: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM mobile_memos WHERE scope = ? AND id = ?", arguments: [scope, id])
        }
    }

    func replaceLocalMemoId(scope: String, temporaryId: String, memo: MemoDetail) throws {
        try dbQueue.write { db in
            try upsertMemo(db, scope: scope, memo: memo)
            try db.execute(sql: "DELETE FROM mobile_memos WHERE scope = ? AND id = ?", arguments: [scope, temporaryId])
            try db.execute(
                sql: """
                INSERT OR REPLACE INTO mobile_id_mappings (scope, temporary_id, remote_id, created_at)
                VALUES (?, ?, ?, ?)
                """,
                arguments: [scope, temporaryId, memo.id, ISO8601DateFormatter.edgeEver.string(from: Date())]
            )
        }
    }

    func clearRemoteMirrorPreservingLocal(scope: String) throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM mobile_notebooks WHERE scope = ?", arguments: [scope])
            try db.execute(sql: "DELETE FROM mobile_memos WHERE scope = ? AND id NOT LIKE 'local:%'", arguments: [scope])
        }
    }

    func clearSyncCursor(scope: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "DELETE FROM mobile_sync_meta WHERE scope = ? AND key IN ('cursor', 'identity')",
                arguments: [scope]
            )
        }
    }

    func setCursor(scope: String, cursor: Int) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "INSERT OR REPLACE INTO mobile_sync_meta (scope, key, value) VALUES (?, 'cursor', ?)",
                arguments: [scope, String(cursor)]
            )
        }
    }

    func setIdentity(scope: String, identity: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "INSERT OR REPLACE INTO mobile_sync_meta (scope, key, value) VALUES (?, 'identity', ?)",
                arguments: [scope, identity]
            )
        }
    }

    func getCursor(scope: String) throws -> Int? {
        try dbQueue.read { db in
            guard let value = try String.fetchOne(
                db,
                sql: "SELECT value FROM mobile_sync_meta WHERE scope = ? AND key = 'cursor'",
                arguments: [scope]
            ) else { return nil }
            return Int(value)
        }
    }

    func getIdentity(scope: String) throws -> String? {
        try dbQueue.read { db in
            try String.fetchOne(
                db,
                sql: "SELECT value FROM mobile_sync_meta WHERE scope = ? AND key = 'identity'",
                arguments: [scope]
            )
        }
    }

    func applyBootstrapBatch(scope: String, notebooks: [Notebook]?, memos: [MemoDetail]) throws {
        try dbQueue.write { db in
            if let notebooks {
                for notebook in notebooks {
                    try upsertNotebook(db, scope: scope, notebook: notebook)
                }
            }
            for memo in memos {
                try upsertMemo(db, scope: scope, memo: memo)
            }
        }
    }

    func applyChanges(scope: String, changes: [MobileSyncChange], cursor: Int) throws {
        try dbQueue.write { db in
            for change in changes {
                if change.entityType == "memo" {
                    if let memo = change.memo {
                        try upsertMemo(db, scope: scope, memo: memo)
                    } else {
                        try db.execute(
                            sql: "DELETE FROM mobile_memos WHERE scope = ? AND id = ?",
                            arguments: [scope, change.entityId]
                        )
                    }
                } else if let notebook = change.notebook {
                    try upsertNotebook(db, scope: scope, notebook: notebook)
                } else {
                    try db.execute(
                        sql: "DELETE FROM mobile_notebooks WHERE scope = ? AND id = ?",
                        arguments: [scope, change.entityId]
                    )
                }
            }
            try db.execute(
                sql: "INSERT OR REPLACE INTO mobile_sync_meta (scope, key, value) VALUES (?, 'cursor', ?)",
                arguments: [scope, String(cursor)]
            )
        }
    }

    // MARK: - Private upserts

    private func upsertNotebook(_ db: Database, scope: String, notebook: Notebook) throws {
        let json = try String(data: EdgeEverJSON.encoder.encode(notebook), encoding: .utf8) ?? "{}"
        try db.execute(
            sql: """
            INSERT OR REPLACE INTO mobile_notebooks (scope, id, name, sort_order, data_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            arguments: [scope, notebook.id, notebook.name, notebook.sortOrder, json]
        )
    }

    private func upsertMemo(_ db: Database, scope: String, memo: MemoDetail) throws {
        let json = try String(data: EdgeEverJSON.encoder.encode(memo), encoding: .utf8) ?? "{}"
        try db.execute(
            sql: """
            INSERT OR REPLACE INTO mobile_memos
              (scope, id, notebook_id, title, content_text, tags_text, is_pinned, is_deleted,
               created_at, updated_at, deleted_at, data_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            arguments: [
                scope,
                memo.id,
                memo.notebookId,
                memo.title ?? "",
                memo.contentText,
                memo.tags.joined(separator: " "),
                memo.isPinned ? 1 : 0,
                memo.isDeleted ? 1 : 0,
                memo.createdAt,
                memo.updatedAt,
                memo.deletedAt,
                json,
            ]
        )
    }
}

extension ISO8601DateFormatter {
    static let edgeEver: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let edgeEverFallback: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

enum EdgeEverDate {
    static func nowString() -> String {
        ISO8601DateFormatter.edgeEver.string(from: Date())
    }
}
