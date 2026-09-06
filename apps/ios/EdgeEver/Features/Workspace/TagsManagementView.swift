import SwiftUI

struct TagsManagementView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var tags: [TagSummary] = []
    @State private var renameFrom = ""
    @State private var renameTo = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 12) {
            if let error {
                Text(error).font(.system(size: 13)).foregroundStyle(AppTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            settingsListCard {
                ForEach(Array(tags.enumerated()), id: \.element.name) { index, tag in
                    HStack {
                        Text("#\(tag.name)")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(AppTheme.title)
                        Spacer()
                        Text("\(tag.memoCount)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 52)
                    .overlay(alignment: .top) {
                        if index > 0 { Rectangle().fill(AppTheme.cardBorder).frame(height: 1) }
                    }
                    .contextMenu {
                        Button(env.preferences.t("重命名", en: "Rename")) {
                            renameFrom = tag.name
                            renameTo = tag.name
                        }
                        Button(role: .destructive) {
                            Task { await deleteTag(tag.name) }
                        } label: {
                            Text(env.preferences.t("删除", en: "Delete"))
                        }
                    }
                }
            }
        }
        .task { await load() }
        .alert(env.preferences.t("重命名标签", en: "Rename tag"), isPresented: Binding(
            get: { !renameFrom.isEmpty },
            set: { if !$0 { renameFrom = "" } }
        )) {
            TextField(env.preferences.t("新名称", en: "New name"), text: $renameTo)
            Button(env.preferences.t("保存", en: "Save")) { Task { await rename() } }
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) { renameFrom = "" }
        }
    }

    private func settingsListCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
    }

    private func load() async {
        do { tags = try await env.session.client.listTags() }
        catch let err { error = err.localizedDescription }
    }

    private func rename() async {
        do {
            try await env.session.client.renameTag(tag: renameFrom, name: renameTo)
            renameFrom = ""
            await load()
            await env.runSyncCycle()
        } catch let err { error = err.localizedDescription }
    }

    private func deleteTag(_ name: String) async {
        do {
            try await env.session.client.deleteTag(tag: name)
            await load()
            await env.runSyncCycle()
        } catch let err { error = err.localizedDescription }
    }
}
