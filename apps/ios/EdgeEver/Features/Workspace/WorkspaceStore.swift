import Foundation
import Observation

@Observable
@MainActor
final class WorkspaceStore {
    var notebooks: [Notebook] = []
    var memos: [MemoSummary] = []
    var selectedNotebookId: String?
    var searchText = ""
    var sort: MemoSortMode = .updatedDesc
    var filter: MobileMemoFilterMode = .all
    var totalCount = 0
    var nextOffset: Int?
    var isLoadingList = false
    var isLoadingMore = false
    var listError: String?
    var selectionMode = false
    var selectedMemoIds: Set<String> = []
    var showNotebookPicker = false
    var showActions = false

    /// Memo id that should play a return-bounce when the list reappears after create/edit.
    var bounceMemoId: String?
    /// Bumped so the same memo can bounce again on a later return.
    var bouncePulse: Int = 0

    private var searchTask: Task<Void, Never>?

    var activeNotebook: Notebook? {
        guard let selectedNotebookId else { return nil }
        return notebooks.first { $0.id == selectedNotebookId }
    }

    func reload(env: AppEnvironment, resetOffset: Bool = true) {
        guard let scope = env.session.dataScope else {
            notebooks = []
            memos = []
            return
        }
        do {
            notebooks = try env.mirror.listNotebooks(scope: scope)
            try loadMemos(env: env, scope: scope, resetOffset: resetOffset)
            listError = nil
        } catch {
            listError = error.localizedDescription
        }
    }

    func scheduleSearch(env: AppEnvironment) {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else { return }
            reload(env: env)
        }
    }

    func loadMemos(env: AppEnvironment, scope: String, resetOffset: Bool) throws {
        isLoadingList = resetOffset
        defer { isLoadingList = false }
        let offset = resetOffset ? 0 : (nextOffset ?? memos.count)
        let notebookIds: [String]? = {
            guard let selectedNotebookId else { return nil }
            return NotebookHierarchy.descendantIds(notebooks: notebooks, targetNotebookId: selectedNotebookId)
        }()
        let result = try env.mirror.listMemos(
            scope: scope,
            params: LocalMemoListParams(
                notebookId: nil,
                notebookIds: notebookIds,
                q: searchText,
                sort: sort,
                filter: filter.toMemoFilterMode(),
                limit: 50,
                offset: offset
            )
        )
        if resetOffset {
            memos = result.memos
        } else {
            let existing = Set(memos.map(\.id))
            memos.append(contentsOf: result.memos.filter { !existing.contains($0.id) })
        }
        totalCount = result.totalCount
        nextOffset = result.nextOffset
    }

    func loadMore(env: AppEnvironment) {
        guard let scope = env.session.dataScope, nextOffset != nil, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        try? loadMemos(env: env, scope: scope, resetOffset: false)
    }

    func toggleFilter(_ requested: MobileMemoFilterMode) {
        filter = MobileUI.toggleMemoFilterMode(current: filter, requested: requested)
    }

    func enterSelection(memoId: String? = nil) {
        selectionMode = true
        if let memoId {
            selectedMemoIds = [memoId]
        }
    }

    func clearSelection() {
        selectionMode = false
        selectedMemoIds = []
    }

    func toggleSelected(_ memoId: String) {
        selectedMemoIds = MobileUI.toggleMemoSelection(current: selectedMemoIds, memoId: memoId)
    }

    var allVisibleMemosSelected: Bool {
        !memos.isEmpty && memos.allSatisfy { selectedMemoIds.contains($0.id) }
    }

    var nextSelectionPinValue: Bool {
        let selected = memos.filter { selectedMemoIds.contains($0.id) }
        return !selected.isEmpty && !selected.allSatisfy(\.isPinned)
    }

    func toggleVisibleSelection() {
        let visibleIds = Set(memos.map(\.id))
        if allVisibleMemosSelected {
            selectedMemoIds.subtract(visibleIds)
        } else {
            selectionMode = true
            selectedMemoIds.formUnion(visibleIds)
        }
    }

    /// Request a rebound animation on a list card after create/edit returns to the list.
    func requestMemoBounce(memoId: String?) {
        guard let memoId, !memoId.isEmpty else { return }
        bounceMemoId = memoId
        bouncePulse &+= 1
    }

    func clearMemoBounce() {
        bounceMemoId = nil
    }

    func softDelete(env: AppEnvironment, memoId: String) async {
        guard let scope = env.session.dataScope else { return }
        do {
            if memoId.hasPrefix("local:") {
                try env.outbox.cancelMemo(scope: scope, memoId: memoId)
                try env.mirror.deleteMemo(scope: scope, id: memoId)
            } else {
                _ = try env.mirror.softDeleteMemo(scope: scope, id: memoId)
                try await env.session.client.deleteMemo(id: memoId, permanent: false)
            }
            selectedMemoIds.remove(memoId)
            reload(env: env)
        } catch {
            listError = error.localizedDescription
        }
    }

    func softDeleteSelection(env: AppEnvironment) async {
        let ids = Array(selectedMemoIds)
        for id in ids {
            await softDelete(env: env, memoId: id)
        }
        clearSelection()
    }

    func togglePin(env: AppEnvironment, memo: MemoSummary) async {
        guard let scope = env.session.dataScope else { return }
        do {
            let updated = try await env.session.client.updateMemo(
                id: memo.id,
                expectedRevision: nil,
                expectedContentHash: nil,
                editSessionId: nil,
                notebookId: nil,
                title: nil,
                isPinned: !memo.isPinned,
                contentMarkdown: nil,
                tags: nil
            )
            try env.mirror.upsertMemo(scope: scope, memo: updated)
            reload(env: env)
        } catch {
            listError = error.localizedDescription
        }
    }

    func pinSelection(env: AppEnvironment, isPinned: Bool) async {
        guard let scope = env.session.dataScope, !selectedMemoIds.isEmpty else { return }
        do {
            for memoId in selectedMemoIds {
                let updated = try await env.session.client.updateMemo(
                    id: memoId,
                    expectedRevision: nil,
                    expectedContentHash: nil,
                    editSessionId: nil,
                    notebookId: nil,
                    title: nil,
                    isPinned: isPinned,
                    contentMarkdown: nil,
                    tags: nil
                )
                try env.mirror.upsertMemo(scope: scope, memo: updated)
            }
            clearSelection()
            reload(env: env)
        } catch {
            listError = error.localizedDescription
        }
    }

    func moveSelection(env: AppEnvironment, notebookId: String) async {
        guard let scope = env.session.dataScope else { return }
        for memoId in selectedMemoIds {
            guard var memo = try? env.mirror.resolveMemo(scope: scope, id: memoId) else { continue }
            memo.notebookId = notebookId
            memo.updatedAt = EdgeEverDate.nowString()
            try? env.mirror.upsertMemo(scope: scope, memo: memo)
            try? env.outbox.enqueueUpdate(
                scope: scope,
                payload: MemoUpdatePayload(
                    memoId: memo.id,
                    expectedRevision: memo.revision,
                    expectedContentHash: memo.contentHash,
                    title: memo.title ?? "",
                    contentMarkdown: memo.contentMarkdown,
                    notebookId: notebookId,
                    tags: memo.tags
                )
            )
        }
        await env.runSyncCycle()
        clearSelection()
        reload(env: env)
    }
}

extension MobileMemoFilterMode {
    func toMemoFilterMode() -> MemoFilterMode {
        switch self {
        case .all: return .all
        case .tagged: return .tagged
        case .untagged: return .untagged
        case .pinned: return .pinned
        }
    }
}
