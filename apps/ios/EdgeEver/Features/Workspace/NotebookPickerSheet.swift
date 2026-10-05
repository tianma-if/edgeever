import SwiftUI

/// Android `NotebookPickerModal` parity: handle, header, search, All notes, tree with expand/collapse.
struct NotebookPickerSheet: View {
    @Environment(AppEnvironment.self) private var env
    @Bindable var store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var collapsedIds: Set<String> = []
    @State private var isCreating = false
    @State private var isSaving = false
    @State private var newName = ""
    @State private var newParentId: String?
    @State private var createError: String?

    private var parentIds: Set<String> {
        NotebookHierarchy.parentIdsWithChildren(from: store.notebooks)
    }

    private var allBranchesExpanded: Bool {
        !parentIds.isEmpty && parentIds.allSatisfy { !collapsedIds.contains($0) }
    }

    private var activeName: String {
        if let id = store.selectedNotebookId,
           let name = store.notebooks.first(where: { $0.id == id })?.name
        {
            return name
        }
        return env.preferences.t("全部笔记", en: "All notes")
    }

    private var visibleItems: [NotebookTreeItem] {
        let tree = NotebookHierarchy.treeItems(from: store.notebooks)
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !search.isEmpty {
            let visible = NotebookHierarchy.searchVisibleIds(notebooks: store.notebooks, searchText: search)
            return tree.filter { visible.contains($0.id) }
        }
        return NotebookHierarchy.filterCollapsed(items: tree, collapsedIds: collapsedIds)
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.sheetHandle)
                .frame(width: 42, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 8)

            // Header
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("切换笔记本", en: "Switch notebook"))
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    Text(env.preferences.t("当前：\(activeName)", en: "Current: \(activeName)"))
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    isCreating.toggle()
                    createError = nil
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(env.preferences.t("新建笔记本", en: "New notebook", ja: "新しいノートブック"))
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.title)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 56)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AppTheme.border).frame(height: 1)
            }

            if isCreating {
                VStack(alignment: .leading, spacing: 8) {
                    TextField(env.preferences.t("笔记本名称", en: "Notebook name", ja: "ノートブック名"), text: $newName)
                        .font(.system(size: 15))
                        .foregroundStyle(AppTheme.title)
                        .textInputAutocapitalization(.sentences)
                        .padding(.horizontal, 12)
                        .frame(height: 42)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(AppTheme.border))
                    HStack(spacing: 8) {
                        parentChoice(env.preferences.t("顶层笔记本", en: "Top level", ja: "最上位"), id: nil)
                        if let selected = store.selectedNotebookId {
                            parentChoice(env.preferences.t("位于「\(activeName)」下", en: "Under \(activeName)", ja: "「\(activeName)」の下"), id: selected)
                        }
                    }
                    if let createError {
                        Text(createError)
                            .font(.system(size: 12))
                            .foregroundStyle(.red)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                    Button {
                        Task { await createNotebook() }
                    } label: {
                        Group {
                            if isSaving {
                                ProgressView().tint(.white)
                            } else {
                                Text(env.preferences.t("创建笔记本", en: "Create notebook", ja: "ノートブックを作成"))
                            }
                        }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .background(AppTheme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSaving || newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Search
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                        TextField(env.preferences.t("搜索笔记本", en: "Search notebooks"), text: $query)
                            .font(.system(size: 14))
                            .foregroundStyle(AppTheme.title)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if !query.isEmpty {
                            Button {
                                query = ""
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(AppTheme.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(AppTheme.searchFill)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                    .padding(.bottom, 8)

                    // All notes
                    notebookRow(
                        title: env.preferences.t("全部笔记", en: "All notes"),
                        selected: store.selectedNotebookId == nil,
                        depth: 0,
                        hasChildren: false,
                        collapsed: false,
                        onToggle: nil
                    ) {
                        select(nil)
                    }
                    .padding(.bottom, 4)

                    // Section header
                    HStack {
                        Text(
                            query.trimmingCharacters(in: .whitespaces).isEmpty
                                ? env.preferences.t("笔记本", en: "Notebooks")
                                : env.preferences.t("匹配的笔记本", en: "Matching notebooks")
                        )
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AppTheme.secondary)
                        Spacer()
                        if query.trimmingCharacters(in: .whitespaces).isEmpty, !parentIds.isEmpty {
                            Button {
                                withAnimation(Motion.chip) {
                                    if allBranchesExpanded {
                                        collapsedIds = parentIds
                                    } else {
                                        collapsedIds = []
                                    }
                                }
                            } label: {
                                Text(
                                    allBranchesExpanded
                                        ? env.preferences.t("收起全部", en: "Collapse all")
                                        : env.preferences.t("展开全部", en: "Expand all")
                                )
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(AppTheme.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(minHeight: 32)
                    .padding(.horizontal, 12)

                    // Tree
                    ForEach(visibleItems) { item in
                        let hasChildren = parentIds.contains(item.id)
                        let isCollapsed = collapsedIds.contains(item.id)
                        notebookRow(
                            title: item.name,
                            selected: store.selectedNotebookId == item.id,
                            depth: item.depth,
                            hasChildren: hasChildren && query.trimmingCharacters(in: .whitespaces).isEmpty,
                            collapsed: isCollapsed,
                            onToggle: hasChildren && query.trimmingCharacters(in: .whitespaces).isEmpty
                                ? {
                                    withAnimation(Motion.chip) {
                                        if collapsedIds.contains(item.id) {
                                            collapsedIds.remove(item.id)
                                        } else {
                                            collapsedIds.insert(item.id)
                                        }
                                    }
                                }
                                : nil
                        ) {
                            select(item.id)
                        }
                    }

                    if visibleItems.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "folder")
                                .font(.system(size: 28))
                                .foregroundStyle(AppTheme.muted)
                            Text(env.preferences.t("没有匹配的笔记本", en: "No matching notebooks"))
                                .font(.system(size: 13))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                    }
                }
                .padding(.bottom, 12)
            }
        }
        .background(AppTheme.card)
        .presentationDetents(isCreating ? [.large] : [.medium, .large])
        .presentationDragIndicator(.hidden)
        .onAppear {
            isCreating = store.startCreatingNotebook
            store.startCreatingNotebook = false
            // Match Android: collapse branches not on the path to the active notebook.
            let parents = parentIds
            if let selected = store.selectedNotebookId {
                let keepOpen = NotebookHierarchy.ancestorIds(notebooks: store.notebooks, notebookId: selected)
                collapsedIds = parents.filter { !keepOpen.contains($0) }
            } else {
                collapsedIds = parents
            }
            query = ""
        }
    }

    private func parentChoice(_ title: String, id: String?) -> some View {
        Button {
            newParentId = id
        } label: {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.title)
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 36)
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(newParentId == id ? AppTheme.accent : AppTheme.border)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(newParentId == id ? .isSelected : [])
    }

    private func createNotebook() async {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isSaving, !name.isEmpty, name.count <= 80 else { return }
        isSaving = true
        createError = nil
        defer { isSaving = false }
        do {
            let notebook = try await env.session.client.createNotebook(name: name, parentId: newParentId)
            if let scope = env.session.dataScope {
                try? env.mirror.saveNotebook(scope: scope, notebook: notebook)
            }
            store.selectedTag = nil
            store.selectedNotebookId = notebook.id
            store.reload(env: env)
            if !store.notebooks.contains(where: { $0.id == notebook.id }) {
                store.notebooks.append(notebook)
            }
            dismiss()
            Task { await env.runSyncCycle() }
        } catch {
            createError = error.localizedDescription
        }
    }

    private func select(_ id: String?) {
        store.selectedTag = nil
        store.selectedNotebookId = id
        store.reload(env: env)
        dismiss()
    }

    @ViewBuilder
    private func notebookRow(
        title: String,
        selected: Bool,
        depth: Int,
        hasChildren: Bool,
        collapsed: Bool,
        onToggle: (() -> Void)?,
        onSelect: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            if hasChildren, let onToggle {
                Button(action: onToggle) {
                    Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.secondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
            } else {
                Color.clear.frame(width: 28, height: 28)
            }

            Button(action: onSelect) {
                HStack {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.title)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(AppTheme.title)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, CGFloat(min(depth * 18, 54)))
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .background(selected ? AppTheme.searchFill : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .padding(.horizontal, 8)
    }
}
