import Foundation

// MARK: - Auth

struct AuthUser: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var username: String
    var displayName: String?
    var role: String
}

struct AuthSession: Codable, Equatable, Sendable {
    var authRequired: Bool
    var authenticated: Bool
    var demoMode: Bool
    var user: AuthUser?
    var sessionToken: String?
}

struct LoginInput: Encodable, Sendable {
    var username: String
    var password: String
    var deviceId: String
}

struct MobileSession: Codable, Equatable, Sendable {
    var baseUrl: String
    var token: String
    var user: AuthUser?
}

struct InstanceStorageDiagnostics: Codable, Equatable, Sendable {
    var database: String?
    var resources: String?
}

struct InstanceHealth: Codable, Equatable, Sendable {
    var ok: Bool
    var name: String
    var runtime: String?
    var containerImageSource: String?
    var authMode: String?
    var build: String?
    var migration: String?
    var storage: InstanceStorageDiagnostics?
    var objectStorageProvider: String?
}

struct InstanceRelease: Codable, Equatable, Sendable {
    var version: String
}

struct LoginDeviceSession: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var userAgent: String?
    var label: String?
    var ipAddress: String?
    var ipCountry: String?
    var ipRegion: String?
    var isCurrent: Bool
    var createdAt: String
    var lastSeenAt: String
    var expiresAt: String
}

// MARK: - Notebook / Memo

struct Notebook: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var parentId: String?
    var name: String
    var slug: String?
    var icon: String?
    var color: String?
    var sortOrder: Int
    var memoCount: Int
    var lastMemoUpdatedAt: String?
    var createdAt: String
    var updatedAt: String
}

struct MemoSummary: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var notebookId: String
    var title: String?
    var excerpt: String
    var tags: [String]
    var isPinned: Bool
    var isArchived: Bool
    var isDeleted: Bool
    var revision: Int
    var createdAt: String
    var updatedAt: String
    var deletedAt: String?
}

struct MemoDetail: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var notebookId: String
    var title: String?
    var excerpt: String
    var tags: [String]
    var isPinned: Bool
    var isArchived: Bool
    var isDeleted: Bool
    var revision: Int
    var createdAt: String
    var updatedAt: String
    var deletedAt: String?
    var contentJson: JSONValue
    var contentMarkdown: String
    var contentText: String
    var contentHash: String
    var sourceMemoIds: [String]
    var mergeSourceCount: Int
    var mergedIntoMemoId: String?

    var displayTitle: String {
        let t = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "无标题笔记" : t
    }

    func asSummary() -> MemoSummary {
        MemoSummary(
            id: id,
            notebookId: notebookId,
            title: title,
            excerpt: excerpt,
            tags: tags,
            isPinned: isPinned,
            isArchived: isArchived,
            isDeleted: isDeleted,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt,
            deletedAt: deletedAt
        )
    }
}

struct MemoEditSession: Codable, Equatable, Sendable {
    var id: String
    var memoId: String
    var baseRevision: Int
    var baseContentHash: String
    var expiresAt: String
}

// MARK: - AI note processing

enum AiAction: String, Codable, CaseIterable, Sendable, Identifiable {
    case summarize
    case extractKeyPoints = "extract-key-points"
    case extractTodos = "extract-todos"
    case rewriteProofread = "rewrite-proofread"
    case translate
    case improveWriting = "improve-writing"
    case fixSpellingGrammar = "fix-spelling-grammar"
    case makeShorter = "make-shorter"
    case makeLonger = "make-longer"
    case simplifyLanguage = "simplify-language"
    case changeTone = "change-tone"
    case continueWriting = "continue-writing"
    case custom

    var id: String { rawValue }
}

struct AiGenerateInput: Encodable, Sendable {
    var action: AiAction
    var promptId: String? = nil
    var locale: String? = nil
    var title: String
    var contentMarkdown: String
    var targetLanguage: String?
    var tone: String? = nil
    var instruction: String? = nil
}

struct AiTagSuggestionsInput: Encodable, Sendable {
    var title: String
    var contentMarkdown: String
    var currentTags: [String]
    var locale: String
}

struct AiTagSuggestion: Codable, Equatable, Sendable, Identifiable {
    var name: String
    var existing: Bool

    var id: String { name }
}

struct AiTagSuggestionsResponse: Codable, Equatable, Sendable {
    var suggestions: [AiTagSuggestion]
}

enum AiPromptParameterKind: String, Codable, Sendable {
    case none
    case targetLanguage = "target-language"
    case tone
}

enum AiPromptResultMode: String, Codable, Sendable {
    case append
    case replace
    case both
}

struct AiPromptTemplate: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var origin: String
    var seedKey: String?
    var action: AiAction
    var parameterKind: AiPromptParameterKind
    var resultMode: AiPromptResultMode
    var nameCustomized: Bool
    var descriptionCustomized: Bool
    var instructionCustomized: Bool
    var name: String
    var description: String?
    var instruction: String
    var createdAt: String
    var updatedAt: String
}

struct AiStreamEvent: Decodable, Sendable {
    var type: String
    var text: String?
    var code: String?
    var message: String?
    var finishReason: String?
    var inputTokens: Int?
    var outputTokens: Int?
}

struct Resource: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var memoId: String
    var originalMemoId: String?
    var kind: String
    var mimeType: String?
    var filename: String?
    var byteSize: Int
    var sha256: String?
    var width: Int?
    var height: Int?
    var createdAt: String
    var updatedAt: String
    var url: String
}

struct ApiToken: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var token: String?
    var scopes: [String]
    var lastUsedAt: String?
    var expiresAt: String?
    var isRevoked: Bool
    var createdAt: String
}

struct CreatedApiToken: Codable, Equatable, Sendable {
    var token: String
    var apiToken: ApiToken
}

struct TagSummary: Codable, Equatable, Sendable {
    var name: String
    var memoCount: Int
    var updatedAt: String?
}

struct MemoRevision: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var memoId: String
    var revision: Int
    var title: String?
    var tags: [String]
    var contentMarkdown: String
    var contentText: String
    var contentHash: String
    var createdBy: String
    var createdAt: String
}

struct MemoShare: Codable, Equatable, Sendable {
    var memoId: String
    var token: String
    var createdAt: String
    var updatedAt: String
}

struct InstanceUser: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var username: String
    var displayName: String?
    var role: String
    var isDisabled: Bool
    var lastLoginAt: String?
    var createdAt: String
}

// MARK: - Sync wire types

struct MobileSyncBootstrapPage: Codable, Sendable {
    var notebooks: [Notebook]
    var memos: [MemoDetail]
    var snapshotCursor: Int
    var syncIdentity: String?
    var totalCount: Int
    var nextAfterId: String?
}

struct MobileSyncChange: Codable, Sendable {
    var cursor: Int
    var entityType: String
    var entityId: String
    var operation: String
    var notebook: Notebook?
    var memo: MemoDetail?
}

struct MobileSyncChangesPage: Codable, Sendable {
    var changes: [MobileSyncChange]
    var cursor: Int
    var hasMore: Bool
    var serverCursor: Int?
    var syncIdentity: String?
}

// MARK: - Envelope helpers

struct MemoResponse: Codable, Sendable {
    var memo: MemoDetail
}

struct NotebookResponse: Codable, Sendable {
    var notebook: Notebook
}

struct NotebooksResponse: Codable, Sendable {
    var notebooks: [Notebook]
}

struct EditSessionResponse: Codable, Sendable {
    var editSession: MemoEditSession
}

struct ResourceResponse: Codable, Sendable {
    var resource: Resource
}

struct OkResponse: Codable, Sendable {
    var ok: Bool
}

struct SessionsResponse: Codable, Sendable {
    var sessions: [LoginDeviceSession]
}

struct ApiTokensResponse: Codable, Sendable {
    var apiTokens: [ApiToken]
    var availableScopes: [String]
}

struct TagsResponse: Codable, Sendable {
    var tags: [TagSummary]
}

struct AiPromptsResponse: Codable, Sendable {
    var prompts: [AiPromptTemplate]
}

// MARK: - Outbox / drafts domain

enum MemoSortMode: String, CaseIterable, Sendable {
    case updatedDesc = "updated-desc"
    case createdDesc = "created-desc"
    case titleAsc = "title-asc"
}

enum MemoFilterMode: String, CaseIterable, Sendable {
    case all
    case tagged
    case untagged
    case pinned
}

struct MemoCreatePayload: Codable, Equatable, Sendable {
    var memoId: String
    var title: String
    var contentMarkdown: String
    /// TipTap JSON when available (preserves image width attrs markdown drops).
    var contentJson: String? = nil
    var notebookId: String
    var tags: [String]
    var createdAt: String
}

struct MemoUpdatePayload: Codable, Equatable, Sendable {
    var memoId: String
    var expectedRevision: Int
    var expectedContentHash: String
    var title: String
    var contentMarkdown: String
    /// TipTap JSON when available (preserves image width attrs markdown drops).
    var contentJson: String? = nil
    var notebookId: String
    var tags: [String]
}

enum OutboxKind: String, Codable, Sendable {
    case memoCreate = "memo.create"
    case memoUpdate = "memo.update"
}

enum OutboxStatus: String, Codable, Sendable {
    case pending
    case syncing
    case conflict
    case error
}

struct OutboxItem: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var kind: OutboxKind
    var memoId: String
    var status: OutboxStatus
    var payloadJSON: String
    var attemptCount: Int
    var lastError: String?
    var nextAttemptAt: String?
    var createdAt: String
    var updatedAt: String
    var version: Int

    func createPayload() throws -> MemoCreatePayload {
        try EdgeEverJSON.decoder.decode(MemoCreatePayload.self, from: Data(payloadJSON.utf8))
    }

    func updatePayload() throws -> MemoUpdatePayload {
        try EdgeEverJSON.decoder.decode(MemoUpdatePayload.self, from: Data(payloadJSON.utf8))
    }
}

struct MemoDraft: Codable, Equatable, Sendable {
    var draftKey: String
    var title: String
    var contentMarkdown: String
    var contentJson: String?
    var notebookId: String
    var tagsText: String
    var expectedRevision: Int?
    var updatedAt: String
}

struct SyncRunResult: Equatable, Sendable {
    var attempted = 0
    var synced = 0
    var failed = 0
    var conflicted = 0
}

struct BootstrapProgress: Equatable, Sendable {
    var loadedCount: Int
    var totalCount: Int
}

// MARK: - Flexible JSON for TipTap docs

enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    static var emptyDoc: JSONValue {
        .object([
            "type": .string("doc"),
            "content": .array([.object(["type": .string("paragraph")])]),
        ])
    }

    func jsonString() throws -> String {
        let data = try EdgeEverJSON.encoder.encode(self)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    static func parse(_ string: String) throws -> JSONValue {
        try EdgeEverJSON.decoder.decode(JSONValue.self, from: Data(string.utf8))
    }
}

extension MemoDetail {
    static func localPlaceholder(
        id: String,
        notebookId: String,
        title: String,
        contentMarkdown: String,
        tags: [String],
        createdAt: String
    ) -> MemoDetail {
        MemoDetail(
            id: id,
            notebookId: notebookId,
            title: title,
            excerpt: String(contentMarkdown.prefix(160)),
            tags: tags,
            isPinned: false,
            isArchived: false,
            isDeleted: false,
            revision: 0,
            createdAt: createdAt,
            updatedAt: createdAt,
            deletedAt: nil,
            contentJson: .emptyDoc,
            contentMarkdown: contentMarkdown,
            contentText: contentMarkdown,
            contentHash: "",
            sourceMemoIds: [],
            mergeSourceCount: 0,
            mergedIntoMemoId: nil
        )
    }
}
