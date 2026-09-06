import Foundation
import UIKit

/// Port of `@edgeever/shared/mobile-ui` — keep behavior identical to Android RN.
enum MobileUIMetrics {
    static let bottomNavigationHeight: CGFloat = 52
    static let compactControlHeight: CGFloat = 36
    /// Legacy Android float size (52). Bottom-tab create uses `bottomCreateButtonSize` instead
    /// so the circle sits fully under the separator without straddling the top border.
    static let floatingCreateButtonSize: CGFloat = 52
    /// Slightly smaller create disc for the bottom tab bar (below separator).
    static let bottomCreateButtonSize: CGFloat = 44
    static let floatingSheetCornerRadius: CGFloat = 10
    static let minimumTouchTarget: CGFloat = 44

    /// Home-indicator / gesture bar inset — same role as RN `useSafeAreaInsets().bottom`.
    /// Used so bottom chrome height is `bottomNavigationHeight + bottomSafeInset` (Android parity).
    static var bottomSafeInset: CGFloat {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            if let key = scene.windows.first(where: \.isKeyWindow) {
                return key.safeAreaInsets.bottom
            }
        }
        return scenes.flatMap(\.windows).first?.safeAreaInsets.bottom ?? 0
    }

    /// Total bottom chrome height including home indicator (Android `height: 52 + safeAreaInsets.bottom`).
    static var bottomChromeHeight: CGFloat {
        bottomNavigationHeight + bottomSafeInset
    }
}

enum MobileMemoFilterMode: String, CaseIterable, Sendable {
    case all
    case tagged
    case untagged
    case pinned
}

/// Matches Android `MobileMemoListDensity`: preview | compact.
enum ListDensity: String, CaseIterable, Sendable {
    case preview
    case compact

    var showsExcerpt: Bool { self == .preview }
    var cardMinHeight: CGFloat { self == .compact ? 84 : 132 }
    var cardPadding: CGFloat { self == .compact ? 13 : 16 }
    var cardBottomMargin: CGFloat { self == .compact ? 10 : 12 }
    var metaTop: CGFloat { self == .compact ? 8 : 20 }
}

enum MobileUI {
    /// Toggle filter chip: pressing the active filter returns to `all`.
    static func toggleMemoFilterMode(
        current: MobileMemoFilterMode,
        requested: MobileMemoFilterMode
    ) -> MobileMemoFilterMode {
        guard requested != .all else { return .all }
        return current == requested ? .all : requested
    }

    static func toggleMemoSelection(current: Set<String>, memoId: String) -> Set<String> {
        var next = current
        if next.contains(memoId) {
            next.remove(memoId)
        } else {
            next.insert(memoId)
        }
        return next
    }
}

struct NotebookTreeItem: Identifiable, Equatable {
    var id: String
    var name: String
    var parentId: String?
    var depth: Int
    var memoCount: Int
}

enum NotebookHierarchy {
    /// Port of `getNotebookDescendantIds` from packages/shared notebooks.ts
    static func descendantIds(notebooks: [Notebook], targetNotebookId: String) -> [String] {
        var childrenByParent: [String: [String]] = [:]
        for notebook in notebooks {
            guard let parentId = notebook.parentId else { continue }
            childrenByParent[parentId, default: []].append(notebook.id)
        }
        var descendantIds: [String] = []
        var visited = Set<String>()
        var pending = [targetNotebookId]
        while let notebookId = pending.popLast() {
            if visited.contains(notebookId) { continue }
            visited.insert(notebookId)
            descendantIds.append(notebookId)
            pending.append(contentsOf: childrenByParent[notebookId] ?? [])
        }
        return descendantIds
    }

    static func treeItems(from notebooks: [Notebook]) -> [NotebookTreeItem] {
        let byParent = Dictionary(grouping: notebooks) { $0.parentId ?? "" }
        var items: [NotebookTreeItem] = []
        func walk(parentId: String?, depth: Int) {
            let key = parentId ?? ""
            let children = (byParent[key] ?? []).sorted {
                if $0.sortOrder != $1.sortOrder { return $0.sortOrder < $1.sortOrder }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
            for child in children {
                items.append(
                    NotebookTreeItem(
                        id: child.id,
                        name: child.name,
                        parentId: child.parentId,
                        depth: depth,
                        memoCount: child.memoCount
                    )
                )
                walk(parentId: child.id, depth: depth + 1)
            }
        }
        walk(parentId: nil, depth: 0)
        return items
    }

    /// Port of `getMobileNotebookSearchVisibleIds`
    static func searchVisibleIds(notebooks: [Notebook], searchText: String) -> Set<String> {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let byId = Dictionary(uniqueKeysWithValues: notebooks.map { ($0.id, $0) })
        if query.isEmpty {
            return Set(byId.keys)
        }
        var childrenByParent: [String: [String]] = [:]
        for notebook in notebooks {
            guard let parentId = notebook.parentId, byId[parentId] != nil else { continue }
            childrenByParent[parentId, default: []].append(notebook.id)
        }
        var visible = Set<String>()
        func includeDescendants(_ id: String, visited: inout Set<String>) {
            if visited.contains(id) { return }
            visited.insert(id)
            visible.insert(id)
            for child in childrenByParent[id] ?? [] {
                includeDescendants(child, visited: &visited)
            }
        }
        for notebook in notebooks where notebook.name.lowercased().contains(query) {
            var visited = Set<String>()
            includeDescendants(notebook.id, visited: &visited)
            var parentId = notebook.parentId
            var seen: Set<String> = [notebook.id]
            while let pid = parentId, !seen.contains(pid) {
                seen.insert(pid)
                visible.insert(pid)
                parentId = byId[pid]?.parentId
            }
        }
        return visible
    }

    /// Parent ids that have at least one child (collapse targets).
    static func parentIdsWithChildren(from notebooks: [Notebook]) -> Set<String> {
        var parents = Set<String>()
        let ids = Set(notebooks.map(\.id))
        for notebook in notebooks {
            if let parentId = notebook.parentId, ids.contains(parentId) {
                parents.insert(parentId)
            }
        }
        return parents
    }

    /// Ancestors of `notebookId` (not including itself).
    static func ancestorIds(notebooks: [Notebook], notebookId: String) -> Set<String> {
        let byId = Dictionary(uniqueKeysWithValues: notebooks.map { ($0.id, $0) })
        var ancestors = Set<String>()
        var current = byId[notebookId]
        while let parentId = current?.parentId {
            ancestors.insert(parentId)
            current = byId[parentId]
        }
        return ancestors
    }

    /// Port of `filterCollapsedNotebookOptions`.
    static func filterCollapsed(items: [NotebookTreeItem], collapsedIds: Set<String>) -> [NotebookTreeItem] {
        if collapsedIds.isEmpty { return items }
        var visible: [NotebookTreeItem] = []
        var hiddenDepth: Int?
        for item in items {
            if let hiddenDepth, item.depth > hiddenDepth {
                continue
            }
            hiddenDepth = nil
            visible.append(item)
            if collapsedIds.contains(item.id) {
                hiddenDepth = item.depth
            }
        }
        return visible
    }
}

enum MemoPreviewDate {
    /// Port of Android `formatMemoPreviewDate`: today → time, yesterday → 昨天, else y/m/d.
    static func format(_ iso: String, locale: Locale = .current, isEnglish: Bool = false) -> String {
        let parsers = [ISO8601DateFormatter.edgeEver, ISO8601DateFormatter.edgeEverFallback]
        guard let date = parsers.compactMap({ $0.date(from: iso) }).first else { return "" }
        let calendar = Calendar.current
        let now = Date()
        if calendar.isDateInToday(date) {
            let f = DateFormatter()
            f.locale = locale
            f.dateStyle = .none
            f.timeStyle = .short
            return f.string(from: date)
        }
        if calendar.isDateInYesterday(date) {
            return isEnglish ? "Yesterday" : "昨天"
        }
        let f = DateFormatter()
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate("yMd")
        return f.string(from: date)
    }
}

enum MemoListTimestampField {
    case createdAt
    case updatedAt

    static func resolve(for sort: MemoSortMode) -> Self {
        sort == .createdDesc ? .createdAt : .updatedAt
    }

    func value(from memo: MemoSummary) -> String {
        switch self {
        case .createdAt: memo.createdAt
        case .updatedAt: memo.updatedAt
        }
    }
}

enum MemoDetailDate {
    static func format(
        _ iso: String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let parsers = [ISO8601DateFormatter.edgeEver, ISO8601DateFormatter.edgeEverFallback]
        guard let date = parsers.compactMap({ $0.date(from: iso) }).first else { return "" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
