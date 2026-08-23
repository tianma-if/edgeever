import SwiftUI
import Pow
import UIKit

/// Android WorkspaceMemoDetail shell parity (detailHeader*, detailMeta*, detailEditFab).
struct MemoDetailView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    let memoId: String
    /// Present editor from the parent `WorkspaceView` (more reliable than cover on a pushed page).
    var onEdit: (String) -> Void = { _ in }

    @State private var memo: MemoDetail?
    @State private var showRevisions = false
    @State private var memoSharePayload: MemoSharePayload?
    @State private var imageExportSharePayload: MemoImageExportSharePayload?
    @State private var imageExportPreviewPayload: MemoImageExportPreviewPayload?
    @State private var imageExportDocumentPayload: MemoImageExportDocumentPayload?
    @State private var imageExportMessage: MemoImageExportMessage?
    @State private var imageExporting = false
    @State private var imageExportBuffer = MemoImageExportBuffer()
    @State private var imageShareOptionsOpen = false
    @State private var imageShareFormat = "png"
    @State private var imageShareTheme = "slate"
    @State private var imageShareFontStyle = "serif"
    @State private var imageShareFontSize = "lg"
    @State private var imageShareCardWidth = "standard"
    @State private var imageShareTitle = true
    @State private var imageShareNotebook = false
    @State private var imageShareTags = false
    @State private var imageShareUpdatedAt = true
    @State private var imageShareBranding = true
    @State private var imageExportIntent: MemoImageExportIntent = .share
    @State private var error: String?
    @State private var conflictItem: OutboxItem?
    @State private var outboxStatus: OutboxStatus?
    @State private var lastOutboxError: String?
    @State private var pinPulse = false
    @State private var searchOpen = false
    @State private var searchQuery = ""
    @State private var searchMatchCount = 0
    @State private var searchMatchIndex = 0
    @State private var showDeleteConfirm = false
    @State private var showMoreMenu = false
    @State private var showNoteIdCopied = false
    @State private var showAiAssistant = false
    @State private var resourceTarget: ResourceTarget?
    @State private var imagePreview: (source: String, alt: String)?
    /// TipTap EditorBundle is ~4MB; keep native text visible until first setContent finishes.
    @State private var bodyReady = false

    var body: some View {
        VStack(spacing: 0) {
            detailHeader
            if syncStatus == .conflict, memo != nil {
                conflictBanner
            } else if syncStatus == .error || syncStatus == .pending, memo != nil {
                syncBanner
            }
            if let memo {
                detailBody(memo)
            } else if let error {
                ContentUnavailableView(
                    env.preferences.t("加载失败", en: "Failed to load"),
                    systemImage: "exclamationmark.triangle",
                    description: Text(error)
                )
            } else {
                // Should almost never flash: load() runs onAppear before next frame when mirror is warm.
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppTheme.card)
        // UIKit FAB in overlay — SwiftUI Button over WKWebView often receives zero taps.
        .overlay(alignment: .bottomTrailing) {
            if let memo, !memo.isDeleted {
                EditFabButton(
                    accessibilityLabel: env.preferences.t("编辑笔记", en: "Edit note")
                ) {
                    onEdit(memo.id)
                }
                .frame(width: 56, height: 56)
                .padding(.trailing, 12)
                .padding(.bottom, 12)
            }
        }
        .background(AppTheme.card.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityIdentifier(DetailMemoChrome.root)
        .sheet(isPresented: $showRevisions) {
            if let memo {
                RevisionsView(
                    memoId: memo.id,
                    memoTitle: memo.title,
                    isDeleted: memo.isDeleted
                ) {
                    showRevisions = false
                    load()
                }
            }
        }
        .sheet(item: $conflictItem) { item in
            ConflictResolutionView(item: item) {
                conflictItem = nil
                load()
                refreshSyncStatus()
            }
        }
        .sheet(item: $resourceTarget) { target in
            ResourceActionSheet(
                target: target,
                canMutate: memo.map { !$0.isDeleted && !$0.id.hasPrefix("local:") } ?? false,
                onContentChanged: { load() }
            )
            .presentationDetents([.height(360), .medium])
            .presentationDragIndicator(.hidden)
        }
        .sheet(item: $memoSharePayload) { payload in
            ActivityShareView(items: [payload.message, payload.url]) { _, _, error in
                if let error { self.error = error.localizedDescription }
                memoSharePayload = nil
            }
        }
        .sheet(item: $imageExportSharePayload) { payload in
            ActivityShareView(items: [payload.url]) { _, _, shareError in
                if let shareError {
                    imageExportMessage = MemoImageExportMessage(
                        title: env.preferences.t("导出失败", en: "Export failed"),
                        message: shareError.localizedDescription
                    )
                }
                imageExportSharePayload = nil
            }
        }
        .sheet(item: $imageExportDocumentPayload) { payload in
            MemoImageDocumentExportView(fileURL: payload.url) { result in
                if case let .failure(exportError) = result {
                    imageExportMessage = MemoImageExportMessage(
                        title: env.preferences.t("保存失败", en: "Save failed"),
                        message: exportError.localizedDescription
                    )
                }
                imageExportDocumentPayload = nil
            }
        }
        .sheet(item: $imageExportPreviewPayload) { payload in
            MemoImageExportPreviewView(
                payload: payload,
                isEnglish: env.preferences.isEnglish,
                onCopy: {
                    guard let image = UIImage(contentsOfFile: payload.url.path) else {
                        imageExportMessage = MemoImageExportMessage(
                            title: env.preferences.t("复制失败", en: "Copy failed"),
                            message: env.preferences.t("无法读取生成的图片。", en: "The generated image could not be read.")
                        )
                        return
                    }
                    UIPasteboard.general.image = image
                    imageExportMessage = MemoImageExportMessage(
                        title: env.preferences.t("复制成功", en: "Copied"),
                        message: env.preferences.t("图片已复制到剪贴板。", en: "The image is on your clipboard.")
                    )
                },
                onSave: {
                    imageExportPreviewPayload = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        imageExportDocumentPayload = MemoImageExportDocumentPayload(url: payload.url)
                    }
                },
                onShare: {
                    imageExportPreviewPayload = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        imageExportSharePayload = MemoImageExportSharePayload(url: payload.url)
                    }
                }
            )
        }
        .sheet(isPresented: $imageShareOptionsOpen) {
            NavigationStack {
                Form {
                    Section(env.preferences.t("主题风格", en: "Theme")) {
                        Picker(env.preferences.t("主题风格", en: "Theme"), selection: $imageShareTheme) {
                            Text(env.preferences.t("经典浅色", en: "Light")).tag("slate")
                            Text(env.preferences.t("极光渐变", en: "Aurora")).tag("aurora")
                            Text(env.preferences.t("暮色晚霞", en: "Sunset")).tag("sunset")
                            Text(env.preferences.t("暗夜曜石", en: "Midnight")).tag("midnight")
                            Text(env.preferences.t("薄荷", en: "Mint")).tag("mint")
                            Text(env.preferences.t("紫雾流光", en: "Lavender")).tag("lavender")
                            Text(env.preferences.t("经典便签", en: "Notepad")).tag("notepad")
                            Text(env.preferences.t("水墨宣纸", en: "Rice Paper")).tag("xuan")
                        }
                        .pickerStyle(.menu)
                    }
                    Section(env.preferences.t("字体风格", en: "Typography")) {
                        Picker(env.preferences.t("字体风格", en: "Typography"), selection: $imageShareFontStyle) {
                            Text(env.preferences.t("文艺衬线", en: "Serif")).tag("serif")
                            Text(env.preferences.t("现代无衬线", en: "Sans")).tag("sans")
                            Text(env.preferences.t("极客等宽", en: "Mono")).tag("mono")
                        }
                        .pickerStyle(.segmented)
                    }
                    Section(env.preferences.t("字号大小", en: "Font size")) {
                        Picker(env.preferences.t("字号大小", en: "Font size"), selection: $imageShareFontSize) {
                            Text(env.preferences.t("紧凑", en: "Compact")).tag("sm")
                            Text(env.preferences.t("标准", en: "Standard")).tag("md")
                            Text(env.preferences.t("舒适", en: "Comfortable")).tag("lg")
                        }
                        .pickerStyle(.segmented)
                    }
                    Section(env.preferences.t("卡片宽度", en: "Card width")) {
                        Picker(env.preferences.t("卡片宽度", en: "Card width"), selection: $imageShareCardWidth) {
                            Text(env.preferences.t("紧凑", en: "Compact")).tag("compact")
                            Text(env.preferences.t("标准", en: "Standard")).tag("standard")
                            Text(env.preferences.t("宽屏", en: "Wide")).tag("wide")
                        }
                        .pickerStyle(.segmented)
                    }
                    Section(env.preferences.t("显示内容", en: "Content elements")) {
                        Toggle(env.preferences.t("笔记标题", en: "Note title"), isOn: $imageShareTitle)
                        Toggle(env.preferences.t("笔记本", en: "Notebook"), isOn: $imageShareNotebook)
                        Toggle(env.preferences.t("标签", en: "Tags"), isOn: $imageShareTags)
                        Toggle(env.preferences.t("更新时间", en: "Updated time"), isOn: $imageShareUpdatedAt)
                        Toggle(env.preferences.t("EdgeEver 品牌标识", en: "EdgeEver branding"), isOn: $imageShareBranding)
                    }
                    Section(env.preferences.t("图片格式", en: "Image format")) {
                        Picker(env.preferences.t("图片格式", en: "Image format"), selection: $imageShareFormat) {
                            Text(env.preferences.t("PNG · 超清无损", en: "PNG · Best for text")).tag("png")
                            Text(env.preferences.t("JPEG · 体积小", en: "JPEG · Smaller file")).tag("jpeg")
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .navigationTitle(env.preferences.t("分享为图片", en: "Share as image"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(env.preferences.t("取消", en: "Cancel")) { imageShareOptionsOpen = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(env.preferences.t("生成预览", en: "Generate Preview")) {
                            guard let memo else { return }
                            imageShareOptionsOpen = false
                            exportMemoImage(
                                memo,
                                format: imageShareFormat,
                                theme: imageShareTheme,
                                fontStyle: imageShareFontStyle,
                                fontSize: imageShareFontSize,
                                cardWidth: imageShareCardWidth,
                                showTitle: imageShareTitle,
                                showNotebook: imageShareNotebook,
                                showTags: imageShareTags,
                                showUpdatedAt: imageShareUpdatedAt,
                                showBranding: imageShareBranding,
                                intent: .preview
                            )
                        }
                        .disabled(imageExporting || !bodyReady || memo == nil)
                    }
                }
            }
        }
        .alert(item: $imageExportMessage) { message in
            Alert(
                title: Text(message.title),
                message: Text(message.message),
                dismissButton: .default(Text(env.preferences.t("确定", en: "OK")))
            )
        }
        .sheet(isPresented: $showAiAssistant) {
            if let memo {
                AiAssistantSheet(memo: memo) { draft, mode in
                    try await applyAiDraft(draft, mode: mode, to: memo)
                }
            }
        }
        .fullScreenCover(isPresented: Binding(
            get: { imagePreview != nil },
            set: { if !$0 { imagePreview = nil } }
        )) {
            if let imagePreview {
                ResourceImagePreviewHost(
                    source: imagePreview.source,
                    alt: imagePreview.alt,
                    baseURL: env.session.session.flatMap { URL(string: $0.baseUrl) },
                    token: env.session.session?.token,
                    onClose: {
                        self.imagePreview = nil
                    },
                    canMutate: memo.map { !$0.isDeleted && !$0.id.hasPrefix("local:") } ?? false,
                    onContentChanged: {
                        load()
                        // Rename/delete may invalidate the blob; close preview after mutation.
                        self.imagePreview = nil
                    }
                )
            }
        }
        .confirmationDialog(
            env.preferences.t("笔记操作", en: "Note actions"),
            isPresented: $showMoreMenu,
            titleVisibility: .visible
        ) {
            if let memo {
                Button(env.preferences.t("编辑", en: "Edit")) { onEdit(memo.id) }
                if !memo.isDeleted && !isTemporaryMemoId(memo.id) {
                    Button(env.preferences.t("AI 笔记助手", en: "AI note assistant")) {
                        showAiAssistant = true
                    }
                }
                Button(
                    memo.isPinned
                        ? env.preferences.t("取消置顶", en: "Unpin")
                        : env.preferences.t("置顶", en: "Pin")
                ) {
                    Task {
                        await togglePin(memo)
                        pinPulse.toggle()
                    }
                }
                Button(env.preferences.t("分享链接", en: "Share link")) {
                    Task { await shareMemo(memo) }
                }
                Button(
                    imageExporting
                        ? env.preferences.t("正在导出图片…", en: "Exporting image…")
                        : env.preferences.t("分享为图片", en: "Share as image")
                ) {
                    imageShareOptionsOpen = true
                }
                .disabled(imageExporting || !bodyReady)
                Button(env.preferences.t("高级导出 PNG", en: "Advanced export PNG")) {
                    exportMemoImage(memo, format: "png")
                }
                .disabled(imageExporting || !bodyReady)
                Button(env.preferences.t("导出 JPEG", en: "Export JPEG")) {
                    exportMemoImage(memo, format: "jpeg")
                }
                .disabled(imageExporting || !bodyReady)
                Button(
                    isTemporaryMemoId(memo.id)
                        ? env.preferences.t("同步后可复制笔记 ID", en: "Copy note ID after sync")
                        : env.preferences.t("复制笔记 ID", en: "Copy note ID")
                ) {
                    UIPasteboard.general.string = memo.id
                    showNoteIdCopied = true
                }
                .disabled(isTemporaryMemoId(memo.id))
                Button(env.preferences.t("修订历史", en: "Revisions")) { showRevisions = true }
                Button(env.preferences.t("删除", en: "Delete"), role: .destructive) {
                    showDeleteConfirm = true
                }
            }
        }
        .alert(env.preferences.t("删除笔记", en: "Delete note"), isPresented: $showDeleteConfirm) {
            Button(env.preferences.t("删除", en: "Delete"), role: .destructive) {
                if let memo { Task { await deleteMemo(memo) } }
            }
            Button(env.preferences.t("取消", en: "Cancel"), role: .cancel) {}
        } message: {
            Text(env.preferences.t("笔记将移入回收站。", en: "The note will move to trash."))
        }
        .alert(
            env.preferences.t("笔记 ID 已复制", en: "Note ID copied"),
            isPresented: $showNoteIdCopied
        ) {
            Button(env.preferences.t("好", en: "OK"), role: .cancel) {}
        } message: {
            Text(memo?.id ?? memoId)
        }
        // Local SQLite mirror is sync and cheap — load before the first blank ProgressView frame.
        .onAppear {
            if memo == nil {
                load()
            }
            refreshSyncStatus()
            TipTapWarmPool.warmIfNeeded()
        }
        .task(id: memoId) {
            // Re-load if mirror was empty on first paint (rare race during bootstrap).
            if memo == nil {
                load()
            }
            refreshSyncStatus()
        }
        .onChange(of: env.isSyncing) { _, _ in
            refreshSyncStatus()
        }
        .onChange(of: memoId) { _, _ in
            bodyReady = false
            searchQuery = ""
            searchMatchCount = 0
            searchMatchIndex = 0
            load()
            refreshSyncStatus()
        }
        .preferredColorScheme(env.preferences.colorScheme)
    }

    // MARK: - Header

    private var detailHeader: some View {
        HStack(spacing: 0) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.slate)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(env.preferences.t("返回列表", en: "Back to list"))
            .accessibilityIdentifier(DetailMemoChrome.back)

            Spacer(minLength: 8)

            HStack(spacing: 2) {
                Button {
                    handleSyncStatusPress()
                } label: {
                    Text(syncLabel)
                        .font(.system(size: 11, weight: syncStatus == .conflict || syncStatus == .error ? .bold : .medium))
                        .foregroundStyle(syncStatus.foreground)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(syncStatus.background)
                        .clipShape(Capsule())
                        .lineLimit(1)
                        .frame(maxWidth: 88)
                }
                .buttonStyle(.plain)
                .disabled(!syncStatus.isInteractive || memo == nil)
                .accessibilityLabel(syncLabel)
                .accessibilityIdentifier(DetailMemoChrome.syncStatus)

                if let memo, !memo.isDeleted {
                    headerIconButton(
                        systemImage: "square.and.arrow.up",
                        label: env.preferences.t("分享笔记", en: "Share note"),
                        id: DetailMemoChrome.share
                    ) {
                        Task { await shareMemo(memo) }
                    }
                    headerIconButton(
                        systemImage: "clock.arrow.circlepath",
                        label: env.preferences.t("版本历史", en: "Version history"),
                        id: DetailMemoChrome.history
                    ) {
                        showRevisions = true
                    }
                    headerIconButton(
                        systemImage: "magnifyingglass",
                        label: env.preferences.t("搜索当前笔记", en: "Search in note"),
                        id: DetailMemoChrome.search
                    ) {
                        withAnimation(Motion.chip) {
                            if searchOpen {
                                closeSearch()
                            } else {
                                searchOpen = true
                            }
                        }
                    }
                    headerIconButton(
                        systemImage: "ellipsis",
                        label: env.preferences.t("笔记操作", en: "Note actions"),
                        id: DetailMemoChrome.more
                    ) {
                        showMoreMenu = true
                    }
                }
            }
            .accessibilityIdentifier(DetailMemoChrome.header)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .background(AppTheme.card)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
        }
        .accessibilityIdentifier(DetailMemoChrome.header)
    }

    private func headerIconButton(
        systemImage: String,
        label: String,
        id: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(AppTheme.slate)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    // MARK: - Banners

    private var conflictBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(env.preferences.t(
                "云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。",
                en: "This note changed on another device or while offline. Copy the local draft, then adopt the cloud version to continue."
            ))
            .font(.system(size: 12))
            .foregroundStyle(AppTheme.dangerStrong)
            .fixedSize(horizontal: false, vertical: true)

            if let lastOutboxError, !lastOutboxError.isEmpty {
                Text(lastOutboxError)
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.dangerStrong)
            }

            HStack(spacing: 8) {
                Button {
                    if let item = conflictItem {
                        // Open full conflict resolution (Android "更多")
                        conflictItem = item
                    } else {
                        detectConflict()
                    }
                } label: {
                    Text(env.preferences.t("处理冲突", en: "Resolve"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(AppTheme.dangerAction)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                Button {
                    Task { await copyLocalDraft() }
                } label: {
                    Text(env.preferences.t("复制本地草稿", en: "Copy local draft"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(AppTheme.dangerStrong)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(AppTheme.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(AppTheme.dangerBorder, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.dangerSurface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.dangerBorder).frame(height: 0.5)
        }
    }

    private var syncBanner: some View {
        let isError = syncStatus == .error
        return VStack(alignment: .leading, spacing: 10) {
            Text(
                lastOutboxError?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                    ?? (isError
                        ? env.preferences.t("本地改动未能上传到云端。内容仍保存在本机，可立即重试。", en: "Local changes could not upload. Content is still on device; retry anytime.")
                        : env.preferences.t("本地改动待上传。下拉刷新或点此可立即同步。", en: "Local changes pending upload. Pull to refresh or tap to sync now."))
            )
            .font(.system(size: 12))
            .foregroundStyle(isError ? AppTheme.dangerStrong : AppTheme.infoText)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Button {
                    Task {
                        // Force: ignore outbox backoff so "Memo not found" retries immediately
                        // and can recover via recreate-on-404 in OutboxFlusher.
                        await env.runSyncCycle(force: true)
                        refreshSyncStatus()
                        load()
                    }
                } label: {
                    Text(env.preferences.t("立即同步", en: "Sync now"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(isError ? AppTheme.dangerAction : AppTheme.infoAction)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                if isError {
                    Button {
                        Task { await copyLocalDraft() }
                    } label: {
                        Text(env.preferences.t("复制本地草稿", en: "Copy local draft"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AppTheme.dangerStrong)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(AppTheme.card)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(AppTheme.dangerBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isError ? AppTheme.dangerSurface : AppTheme.infoSurface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(isError ? AppTheme.dangerBorder : AppTheme.infoText.opacity(0.55))
                .frame(height: 0.5)
        }
    }

    // MARK: - Body

    private func detailBody(_ memo: MemoDetail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    if memo.isPinned {
                        Text("★")
                            .font(.system(size: 16))
                            .foregroundStyle(AppTheme.secondary)
                    }
                    Text(localizedTitle(for: memo))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                        .lineLimit(4)
                        .textSelection(.enabled)
                        .accessibilityIdentifier(DetailMemoChrome.title)
                }
                .padding(.top, 16)
                .edgeEverSuccessShine(trigger: pinPulse)

                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Text(notebookName(for: memo))
                            .font(.system(size: 14))
                            .foregroundStyle(AppTheme.secondary)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(0)
                    .accessibilityIdentifier(DetailMemoChrome.notebook)

                    HStack(spacing: 8) {
                        Image(systemName: "tag")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                        Text(
                            memo.tags.isEmpty
                                ? env.preferences.t("添加标签，用逗号分隔", en: "Add tags, comma separated")
                                : memo.tags.joined(separator: ", ")
                        )
                        .font(.system(size: 14))
                        .foregroundStyle(memo.tags.isEmpty ? AppTheme.muted : AppTheme.secondary)
                        .lineLimit(1)
                        .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier(DetailMemoChrome.tags)
                }
                .frame(minHeight: 32)
                .padding(.top, 12)
                .accessibilityIdentifier(DetailMemoChrome.metaRow)

                if searchOpen {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                        TextField(
                            env.preferences.t("在当前笔记内搜索", en: "Search in this note"),
                            text: $searchQuery
                        )
                        .font(.system(size: 14))
                        .textFieldStyle(.plain)
                        .onChange(of: searchQuery) { _, query in
                            searchMatchIndex = 0
                            SharedTipTapRuntime.viewer.search(query, index: 0)
                        }
                        Text(searchMatchCount == 0 ? "0/0" : "\(searchMatchIndex + 1)/\(searchMatchCount)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AppTheme.secondary)
                            .monospacedDigit()
                        Button {
                            guard searchMatchCount > 0 else { return }
                            let next = (searchMatchIndex - 1 + searchMatchCount) % searchMatchCount
                            SharedTipTapRuntime.viewer.search(searchQuery, index: next)
                        } label: {
                            Image(systemName: "chevron.up")
                                .font(.system(size: 12, weight: .bold))
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .disabled(searchMatchCount == 0)
                        .accessibilityLabel(env.preferences.t("上一个匹配项", en: "Previous match"))
                        Button {
                            guard searchMatchCount > 0 else { return }
                            let next = (searchMatchIndex + 1) % searchMatchCount
                            SharedTipTapRuntime.viewer.search(searchQuery, index: next)
                        } label: {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 12, weight: .bold))
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .disabled(searchMatchCount == 0)
                        .accessibilityLabel(env.preferences.t("下一个匹配项", en: "Next match"))
                        Button {
                            closeSearch()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(AppTheme.title)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(10)
                    .background(AppTheme.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                    .padding(.top, 14)
                }

                Rectangle()
                    .fill(AppTheme.border)
                    .frame(height: 1)
                    .padding(.top, 16)
                    .padding(.bottom, 8)
            }
            .padding(.horizontal, 16)

            // Always show TipTap at full opacity. A plain contentText overlay looked like a
            // "broken layout" (one wall of text) when bodyReady failed to flip.
            ZStack {
                TipTapWebView(
                    mode: .viewer,
                    documentJSON: (try? memo.contentJson.jsonString())
                        ?? "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
                    markdown: memo.contentMarkdown,
                    baseURL: env.session.session.flatMap { URL(string: $0.baseUrl) },
                    token: env.session.session?.token,
                    locale: env.preferences.isEnglish ? "en-US" : "zh-CN",
                    theme: colorScheme == .dark ? "dark" : "light",
                    placeholder: env.preferences.t("开始输入…", en: "Start writing…"),
                    onChange: nil,
                    onResourcePress: { target in
                        resourceTarget = target
                    },
                    onImagePreview: { source, alt in
                        imagePreview = (source, alt)
                    },
                    onPickImage: nil,
                    onSearchResult: { count, index in
                        searchMatchCount = count
                        searchMatchIndex = index
                    },
                    onImageExportEvent: { event in
                        handleImageExportEvent(event)
                    },
                    onBodyReady: {
                        bodyReady = true
                    }
                )

                if !bodyReady {
                    ProgressView()
                        .tint(AppTheme.title)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(AppTheme.card.opacity(0.92))
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier(DetailMemoChrome.body)
            .task(id: memo.id) {
                // Safety net: never leave the spinner forever if a ready callback is missed.
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                if !bodyReady {
                    bodyReady = true
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Sync helpers

    private var syncStatus: DetailSyncStatus {
        DetailSyncStatus.derive(outboxStatus: outboxStatus, isGlobalSyncing: env.isSyncing)
    }

    private var syncLabel: String {
        env.preferences.isEnglish ? syncStatus.labelEN : syncStatus.labelZH
    }

    private func notebookName(for memo: MemoDetail) -> String {
        let notebooks = (try? env.mirror.listNotebooks(scope: env.session.dataScope ?? "")) ?? []
        return notebooks.first(where: { $0.id == memo.notebookId })?.name
            ?? env.preferences.t("笔记本", en: "Notebook")
    }

    private func handleSyncStatusPress() {
        switch syncStatus {
        case .conflict:
            detectConflict()
        case .error, .pending:
            Task {
                await env.runSyncCycle(force: true)
                refreshSyncStatus()
                load()
            }
        case .synced, .syncing:
            break
        }
    }

    private func load() {
        guard let scope = env.session.dataScope else { return }
        do {
            memo = try env.mirror.resolveMemo(scope: scope, id: memoId)
            if memo == nil {
                error = env.preferences.t("本地未找到该笔记，请先同步。", en: "Note not in local cache. Sync first.")
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshSyncStatus() {
        guard let scope = env.session.dataScope else {
            outboxStatus = nil
            lastOutboxError = nil
            return
        }
        let items = (try? env.outbox.listItems(scope: scope)) ?? []
        if let item = items.first(where: { $0.memoId == memoId }) {
            outboxStatus = item.status
            lastOutboxError = item.lastError
            if item.status == .conflict {
                conflictItem = item
            }
        } else {
            outboxStatus = nil
            lastOutboxError = nil
        }
    }

    private func detectConflict() {
        guard let scope = env.session.dataScope else { return }
        let items = (try? env.outbox.listItems(scope: scope)) ?? []
        conflictItem = items.first { $0.memoId == memoId && $0.status == .conflict }
        refreshSyncStatus()
    }

    private func copyLocalDraft() async {
        guard let memo else { return }
        let text = [localizedTitle(for: memo), memo.contentMarkdown].filter { !$0.isEmpty }.joined(separator: "\n\n")
        UIPasteboard.general.string = text
    }

    private func isTemporaryMemoId(_ id: String) -> Bool {
        id.hasPrefix("local:") || id.hasPrefix("local_")
    }

    private func closeSearch() {
        searchOpen = false
        searchQuery = ""
        searchMatchCount = 0
        searchMatchIndex = 0
        SharedTipTapRuntime.viewer.search("", index: 0)
    }

    private func localizedTitle(for memo: MemoDetail) -> String {
        let title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? env.preferences.t("无标题笔记", en: "Untitled note") : title
    }

    private func togglePin(_ memo: MemoDetail) async {
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
            self.memo = updated
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func applyAiDraft(
        _ draft: String,
        mode: AiDraftApplyMode,
        to sourceMemo: MemoDetail
    ) async throws {
        guard let scope = env.session.dataScope else {
            throw APIError(
                status: -1,
                code: "session_unavailable",
                message: env.preferences.t("登录状态已失效，请重新登录。", en: "Your session has expired. Sign in again.")
            )
        }
        let normalizedDraft = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedDraft.isEmpty else { return }
        let currentContent = sourceMemo.contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
        let contentMarkdown = mode == .append && !currentContent.isEmpty
            ? "\(currentContent)\n\n\(normalizedDraft)"
            : normalizedDraft

        let editSession = try await env.session.client.createMemoEditSession(memoId: sourceMemo.id)
        guard
            editSession.baseRevision == sourceMemo.revision,
            editSession.baseContentHash == sourceMemo.contentHash
        else {
            throw APIError(
                status: 409,
                code: "revision_conflict",
                message: env.preferences.t(
                    "笔记已在其他设备更新，请刷新后重新生成。",
                    en: "This note changed on another device. Refresh it and generate again."
                )
            )
        }

        let updated = try await env.session.client.updateMemo(
            id: sourceMemo.id,
            expectedRevision: sourceMemo.revision,
            expectedContentHash: sourceMemo.contentHash,
            editSessionId: editSession.id,
            notebookId: nil,
            title: nil,
            isPinned: nil,
            contentMarkdown: contentMarkdown,
            contentJson: nil,
            tags: nil
        )
        try env.mirror.upsertMemo(scope: scope, memo: updated)
        memo = updated
        refreshSyncStatus()
    }

    private func shareMemo(_ memo: MemoDetail) async {
        do {
            let share = try await env.session.client.createMemoShare(memoId: memo.id)
            let base = env.session.session?.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
            guard let url = URL(string: "\(base)/share/\(share.token)") else { return }
            let title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayTitle = title?.isEmpty == false
                ? title!
                : env.preferences.t("无标题笔记", en: "Untitled note")
            memoSharePayload = MemoSharePayload(message: "\(displayTitle)\n\(url.absoluteString)", url: url)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteMemo(_ memo: MemoDetail) async {
        guard let scope = env.session.dataScope else { return }
        do {
            if memo.id.hasPrefix("local:") {
                try env.outbox.cancelMemo(scope: scope, memoId: memo.id)
                try env.mirror.deleteMemo(scope: scope, id: memo.id)
            } else {
                _ = try env.mirror.softDeleteMemo(scope: scope, id: memo.id)
                try await env.session.client.deleteMemo(id: memo.id, permanent: false)
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func exportMemoImage(
        _ memo: MemoDetail,
        format: String,
        theme: String = "slate",
        fontStyle: String = "serif",
        fontSize: String = "lg",
        cardWidth: String = "standard",
        showTitle: Bool = true,
        showNotebook: Bool = false,
        showTags: Bool = false,
        showUpdatedAt: Bool = true,
        showBranding: Bool = true,
        intent: MemoImageExportIntent = .share
    ) {
        guard !imageExporting, bodyReady else { return }
        let requestId = UUID().uuidString
        imageExportBuffer.start(requestId: requestId)
        imageExportIntent = intent
        imageExporting = true
        let title = memo.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        SharedTipTapRuntime.viewer.exportNoteImage(request: [
            "requestId": requestId,
            "format": format,
            "title": title?.isEmpty == false ? title! : env.preferences.t("无标题笔记", en: "Untitled note"),
            "fallbackTitle": env.preferences.t("无标题笔记", en: "Untitled note"),
            "notebook": showNotebook ? notebookName(for: memo) : "",
            "tags": showTags ? memo.tags : [],
            "updatedAt": showUpdatedAt ? formattedImageExportDate(memo.updatedAt) : "",
            "theme": theme,
            "fontStyle": fontStyle,
            "fontSize": fontSize,
            "cardWidth": cardWidth,
            "showTitle": showTitle,
            "showNotebook": showNotebook,
            "showTags": showTags,
            "showUpdatedAt": showUpdatedAt,
            "branding": showBranding,
        ])
    }

    private func formattedImageExportDate(_ rawValue: String) -> String {
        let parsers = [ISO8601DateFormatter.edgeEver, ISO8601DateFormatter.edgeEverFallback]
        guard let date = parsers.lazy.compactMap({ $0.date(from: rawValue) }).first else { return rawValue }
        let formatter = DateFormatter()
        formatter.locale = env.preferences.isEnglish ? Locale(identifier: "en_US") : Locale(identifier: "zh_CN")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func handleImageExportEvent(_ event: [String: Any]) {
        switch imageExportBuffer.accept(event) {
        case .none:
            break
        case let .failure(message):
            imageExporting = false
            imageExportMessage = MemoImageExportMessage(
                title: env.preferences.t("导出失败", en: "Export failed"),
                message: message
            )
        case let .complete(data, filename, metadata):
            imageExporting = false
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("EdgeEverNoteExports", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let safeFilename = (filename as NSString).lastPathComponent
                let url = directory.appendingPathComponent(safeFilename)
                try data.write(to: url, options: .atomic)
                if imageExportIntent == .preview {
                    imageExportPreviewPayload = MemoImageExportPreviewPayload(
                        url: url,
                        width: metadata.width,
                        height: metadata.height,
                        totalImages: metadata.totalImages,
                        failedImages: metadata.failedImages
                    )
                } else {
                    imageExportSharePayload = MemoImageExportSharePayload(url: url)
                }
            } catch {
                imageExportMessage = MemoImageExportMessage(
                    title: env.preferences.t("导出失败", en: "Export failed"),
                    message: error.localizedDescription
                )
            }
        }
    }
}

private struct MemoSharePayload: Identifiable {
    let id = UUID()
    let message: String
    let url: URL
}

private struct MemoImageExportSharePayload: Identifiable {
    let id = UUID()
    let url: URL
}

private struct MemoImageExportPreviewPayload: Identifiable {
    let id = UUID()
    let url: URL
    let width: Int
    let height: Int
    let totalImages: Int
    let failedImages: Int
}

private struct MemoImageExportDocumentPayload: Identifiable {
    let id = UUID()
    let url: URL
}

private enum MemoImageExportIntent {
    case preview
    case share
}

private struct MemoImageExportMessage: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private struct MemoImageExportPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    let payload: MemoImageExportPreviewPayload
    let isEnglish: Bool
    let onCopy: () -> Void
    let onSave: () -> Void
    let onShare: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 12) {
                        if let image = UIImage(contentsOfFile: payload.url.path) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                                .shadow(color: .black.opacity(0.16), radius: 12, y: 5)
                        } else {
                            ContentUnavailableView(
                                isEnglish ? "Preview unavailable" : "无法预览",
                                systemImage: "photo.badge.exclamationmark"
                            )
                        }
                        if payload.failedImages > 0 {
                            warning(
                                isEnglish
                                    ? "\(payload.failedImages) of \(payload.totalImages) note image(s) could not be included."
                                    : "笔记中的 \(payload.totalImages) 张图片有 \(payload.failedImages) 张未能包含。"
                            )
                        }
                        if payload.height > 12_000 {
                            warning(
                                isEnglish
                                    ? "This is a long image. Some social apps may reduce its quality; keep the saved original."
                                    : "图片较长，部分社交平台可能会压缩画质；建议保留保存的原图。"
                            )
                        }
                    }
                    .padding(16)
                }
                Divider()
                HStack(spacing: 8) {
                    previewButton(isEnglish ? "Copy" : "复制图片", systemImage: "doc.on.doc", action: onCopy)
                    previewButton(isEnglish ? "Save" : "保存图片", systemImage: "square.and.arrow.down", action: onSave)
                    Button(action: onShare) {
                        Label(isEnglish ? "Share" : "系统分享", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 22 / 255, green: 160 / 255, blue: 110 / 255))
                }
                .font(.system(size: 13, weight: .semibold))
                .padding(12)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(isEnglish ? "Image Preview" : "图片预览")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isEnglish ? "Close" : "关闭") { dismiss() }
                }
            }
        }
    }

    private func warning(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Color.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    private func previewButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
    }
}

private struct MemoImageDocumentExportView: UIViewControllerRepresentable {
    let fileURL: URL
    let onFinish: (Result<Bool, Error>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
        picker.delegate = context.coordinator
        picker.shouldShowFileExtensions = true
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onFinish: (Result<Bool, Error>) -> Void
        init(onFinish: @escaping (Result<Bool, Error>) -> Void) { self.onFinish = onFinish }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onFinish(.success(!urls.isEmpty))
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onFinish(.success(false))
        }
    }
}

private final class MemoImageExportBuffer {
    struct Metadata {
        let width: Int
        let height: Int
        let totalImages: Int
        let failedImages: Int
    }

    enum Result {
        case none
        case complete(Data, filename: String, metadata: Metadata)
        case failure(String)
    }

    private var requestId: String?
    private var chunks: [String] = []

    func start(requestId: String) {
        self.requestId = requestId
        chunks.removeAll(keepingCapacity: true)
    }

    func accept(_ event: [String: Any]) -> Result {
        guard let currentRequestId = requestId,
              event["requestId"] as? String == currentRequestId,
              let type = event["type"] as? String
        else { return .none }

        if type == "imageExportChunk" {
            if let chunk = event["chunk"] as? String { chunks.append(chunk) }
            return .none
        }

        defer {
            requestId = nil
            chunks.removeAll(keepingCapacity: false)
        }
        if type == "imageExportError" {
            return .failure(event["message"] as? String ?? "Image export failed")
        }
        guard type == "imageExportComplete",
              let filename = event["filename"] as? String,
              let data = Data(base64Encoded: chunks.joined())
        else { return .failure("Image export returned invalid data") }
        let metadata = Metadata(
            width: (event["width"] as? NSNumber)?.intValue ?? 0,
            height: (event["height"] as? NSNumber)?.intValue ?? 0,
            totalImages: (event["totalImages"] as? NSNumber)?.intValue ?? 0,
            failedImages: (event["failedImages"] as? NSNumber)?.intValue ?? 0
        )
        return .complete(data, filename: filename, metadata: metadata)
    }
}

// MARK: - String helper

private extension String {
    var nilIfEmpty: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

// MARK: - Version history (Android RevisionHistoryModal parity)

/// Android `RevisionHistoryModal`: header + selected summary/restore + timeline pills + markdown preview.
