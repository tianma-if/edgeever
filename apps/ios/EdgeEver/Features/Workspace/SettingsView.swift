import SwiftUI

/// Android `WorkspaceSettingsView` parity: full-screen “我的”, not a system Form/List.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    private enum RootTab: Hashable {
        case general
        case account
        case system
        // Extended (not on Android root Me, but reachable from system/account extras)
        case tags
        case tokens
        case devices
        case users
    }

    @State private var tab: RootTab?
    @State private var showLocalePicker = false
    @State private var copiedSystemInfo = false
    @State private var instanceHealth: InstanceHealth?
    @State private var instanceVersion: String?
    @State private var instanceLatencyMilliseconds: Int?
    @State private var instanceDiagnosticsFailed = false

    private var title: String {
        switch tab {
        case .general: return env.preferences.t("常规设置", en: "General")
        case .account: return env.preferences.t("登录设置", en: "Account")
        case .system: return env.preferences.t("系统信息", en: "System info")
        case .tags: return env.preferences.t("标签管理", en: "Tags")
        case .tokens: return "API Token"
        case .devices: return env.preferences.t("登录设备", en: "Devices")
        case .users: return env.preferences.t("用户管理", en: "Users")
        case nil: return env.preferences.t("我的", en: "Me")
        }
    }

    private var headerIcon: String {
        switch tab {
        case .general: return "slider.horizontal.3"
        case .account: return "shield.checkered"
        case .system: return "info.circle"
        case .tags: return "tag"
        case .tokens: return "key"
        case .devices: return "iphone"
        case .users: return "person.2"
        case nil: return "person"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            settingsHeader
            ScrollView {
                Group {
                    if let tab {
                        detailContent(tab)
                            .transition(.opacity.combined(with: .move(edge: .trailing)))
                    } else {
                        rootMenu
                            .transition(.opacity)
                    }
                }
                .padding(16)
                .padding(.bottom, 96)
                .animation(Motion.listContent, value: tab)
            }
            .background(AppTheme.background)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .preferredColorScheme(env.preferences.colorScheme)
        .task(id: tab) {
            guard tab == .system else { return }
            await loadInstanceDiagnostics()
        }
    }

    // MARK: - Header (Android settingsHeader)

    private var settingsHeader: some View {
        HStack(spacing: 0) {
            Button {
                if tab != nil {
                    withAnimation(Motion.chip) { tab = nil }
                } else {
                    dismiss()
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(AppTheme.secondary)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Image(systemName: headerIcon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                Text(title)
                    .font(.system(size: 16, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 4)

            Button {
                withAnimation(Motion.chip) {
                    env.preferences.theme = resolvedDarkMode ? "light" : "dark"
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: resolvedDarkMode ? "sun.max" : "moon")
                        .font(.system(size: 16, weight: .semibold))
                    Text(themeToggleLabel)
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(1)
                }
                .foregroundStyle(AppTheme.slate)
                .padding(.horizontal, 8)
                .frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 56)
        .background(AppTheme.card)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AppTheme.border).frame(height: 1)
        }
    }

    private var themeToggleLabel: String {
        // Android shows the *action* text: switch to light when dark, else switch to dark
        if resolvedDarkMode {
            return env.preferences.t("切换到浅色模式", en: "Light mode")
        }
        return env.preferences.t("切换到深色模式", en: "Dark mode")
    }

    private var resolvedDarkMode: Bool {
        env.preferences.theme == "dark" || (env.preferences.theme == "system" && colorScheme == .dark)
    }

    // MARK: - Root Me menu (Android activeTab === null)

    private var rootMenu: some View {
        VStack(spacing: 16) {
            // Card 1: general + account
            settingsMenuCard {
                menuRow(
                    icon: "slider.horizontal.3",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("常规设置", en: "General"),
                    showBorder: false
                ) {
                    withAnimation(Motion.chip) { tab = .general }
                }
                menuRow(
                    icon: "shield.checkered",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("登录设置", en: "Account"),
                    showBorder: true
                ) {
                    withAnimation(Motion.chip) { tab = .account }
                }
            }

            // Card 2: system + feedback
            settingsMenuCard {
                menuRow(
                    icon: "info.circle",
                    iconTint: AppTheme.accent,
                    iconBg: AppTheme.accentSoft,
                    title: env.preferences.t("系统信息", en: "System info"),
                    subtitle: env.preferences.t(
                        "查看版本与运行环境信息。",
                        en: "View version and runtime info."
                    ),
                    showBorder: false
                ) {
                    withAnimation(Motion.chip) { tab = .system }
                }
                menuRow(
                    icon: "bubble.left.and.bubble.right",
                    iconTint: AppTheme.secondary,
                    iconBg: AppTheme.searchFill,
                    title: env.preferences.t("意见反馈", en: "Feedback"),
                    subtitle: env.preferences.t(
                        "报告问题或提出功能建议",
                        en: "Report issues or suggest features"
                    ),
                    trailing: .external,
                    showBorder: true
                ) {
                    if let url = feedbackURL { UIApplication.shared.open(url) }
                }
            }
        }
    }

    private enum TrailingKind { case chevron, external }

    private func settingsMenuCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func menuRow(
        icon: String,
        iconTint: Color,
        iconBg: Color,
        title: String,
        subtitle: String? = nil,
        trailing: TrailingKind = .chevron,
        showBorder: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(iconBg)
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(iconTint)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(AppTheme.title)
                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.secondary)
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: trailing == .external ? "arrow.up.right" : "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) {
            if showBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
                    .padding(.leading, 16)
            }
        }
    }

    // MARK: - Detail tabs

    @ViewBuilder
    private func detailContent(_ tab: RootTab) -> some View {
        switch tab {
        case .general:
            generalContent
        case .account:
            accountContent
        case .system:
            systemContent
        case .tags:
            TagsManagementView()
        case .tokens:
            ApiTokensView()
        case .devices:
            DevicesView()
        case .users:
            UsersManagementView()
        }
    }

    private var generalContent: some View {
        VStack(spacing: 16) {
            settingsGroup(
                title: env.preferences.t("偏好设置", en: "Preferences"),
                icon: "photo"
            ) {
                preferenceBlock(
                    title: env.preferences.t("界面语言", en: "Language"),
                    description: env.preferences.t("切换产品界面的显示语言。", en: "Switch the product UI language.")
                ) {
                    Menu {
                        Button(env.preferences.t("跟随系统", en: "System")) { env.preferences.localeCode = "system" }
                        Button("简体中文") { env.preferences.localeCode = "zh-CN" }
                        Button("English") { env.preferences.localeCode = "en-US" }
                    } label: {
                        HStack {
                            Text(localeLabel)
                                .font(.system(size: 14))
                                .foregroundStyle(AppTheme.title)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.secondary)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8).stroke(AppTheme.border, lineWidth: 1)
                        )
                    }
                }

                preferenceBlock(
                    title: env.preferences.t("压缩笔记内图片", en: "Compress note images"),
                    description: env.preferences.t(
                        "上传前将大图压缩为 WebP（最长边 2560），节省存储与流量。",
                        en: "Compress large images to WebP (max edge 2560) before upload to save storage and bandwidth."
                    ),
                    showTopBorder: true
                ) {
                    Toggle("", isOn: Bindable(env.preferences).useCompression)
                        .labelsHidden()
                        .tint(AppTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                // List density lives in list-options sheet (Android NotesActionsModal), not here.
            }
        }
    }

    private var accountContent: some View {
        VStack(spacing: 16) {
            // Account summary card
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(AppTheme.accentSoft).frame(width: 40, height: 40)
                    Image(systemName: "person")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(AppTheme.accentStrong)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(env.preferences.t("当前账户", en: "Current account"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(AppTheme.secondary)
                    Text(env.session.session?.user?.displayName ?? env.session.session?.user?.username ?? "—")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(AppTheme.title)
                    let role = env.session.session?.user?.role == "owner"
                        ? env.preferences.t("实例管理员", en: "Owner")
                        : env.preferences.t("成员", en: "Member")
                    Text("@\(env.session.session?.user?.username ?? "—") · \(role)")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .padding(.top, 1)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )

            // Change password panel (Android AccountSecurityPanel)
            AccountPasswordPanel()

            // Extended links (tokens/devices/users/tags) — compact rows, not on Android root Me
            settingsMenuCard {
                menuRow(icon: "iphone", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: env.preferences.t("登录设备", en: "Devices"), showBorder: false) {
                    withAnimation(Motion.chip) { tab = .devices }
                }
                menuRow(icon: "key", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: "API Token", showBorder: true) {
                    withAnimation(Motion.chip) { tab = .tokens }
                }
                menuRow(icon: "tag", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                        title: env.preferences.t("标签管理", en: "Tags"), showBorder: true) {
                    withAnimation(Motion.chip) { tab = .tags }
                }
                if env.session.session?.user?.role == "owner" {
                    menuRow(icon: "person.2", iconTint: AppTheme.accent, iconBg: AppTheme.accentSoft,
                            title: env.preferences.t("用户管理", en: "Users"), showBorder: true) {
                        withAnimation(Motion.chip) { tab = .users }
                    }
                }
            }

            // Logout card
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    Task {
                        await env.session.signOut()
                        dismiss()
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 15, weight: .bold))
                        Text(env.preferences.t("退出登录", en: "Sign out"))
                            .font(.system(size: 14, weight: .heavy))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 40)
                    .background(AppTheme.dangerAction)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(AppTheme.dangerSurface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.dangerBorder, lineWidth: 1)
            )
        }
    }

    private var systemContent: some View {
        VStack(spacing: 16) {
            settingsGroup(title: env.preferences.t("系统信息", en: "System info"), icon: "info.circle") {
                Button {
                    UIPasteboard.general.string = systemInfoText
                    copiedSystemInfo = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { copiedSystemInfo = false }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: copiedSystemInfo ? "checkmark.shield" : "doc.on.doc")
                        Text(copiedSystemInfo
                            ? env.preferences.t("已复制", en: "Copied")
                            : env.preferences.t("复制信息", en: "Copy info"))
                            .font(.system(size: 14, weight: .bold))
                        Spacer()
                    }
                    .foregroundStyle(copiedSystemInfo ? AppTheme.accentStrong : AppTheme.title)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }

            systemInfoGroup(
                title: env.preferences.t("云端实例", en: "Cloud instance"),
                description: env.preferences.t("当前连接实例的版本与部署环境。", en: "Version and deployment environment for the connected instance."),
                icon: "cloud",
                items: cloudSystemInfoItems
            )

            systemInfoGroup(
                title: env.preferences.t("当前客户端", en: "Current client"),
                description: env.preferences.t("这台设备上的 EdgeEver 应用与运行环境。", en: "The EdgeEver app and runtime environment on this device."),
                icon: "iphone",
                items: clientSystemInfoItems
            )

            systemInfoGroup(
                title: env.preferences.t("连接与同步", en: "Connection and sync"),
                description: env.preferences.t("实例连接与本地同步队列状态。", en: "Connection and local sync queue status."),
                icon: "arrow.triangle.2.circlepath",
                items: connectionSystemInfoItems
            )

            Button {
                Task { await env.runSyncCycle() }
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text(env.preferences.t("立即同步", en: "Sync now"))
                        .font(.system(size: 14, weight: .bold))
                    if env.isSyncing { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .foregroundStyle(AppTheme.title)
                .background(AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.border, lineWidth: 1))
            }
            .buttonStyle(.plain)

            if let err = env.lastSyncError {
                Text(err)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - Building blocks

    private var localeLabel: String {
        switch env.preferences.localeCode {
        case "zh-CN": return "简体中文"
        case "en-US": return "English"
        default: return env.preferences.t("跟随系统", en: "System")
        }
    }

    private var clientSystemInfoItems: [(label: String, value: String)] {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        let language = env.preferences.localeCode == "system"
            ? "\(env.preferences.resolvedLocale.identifier) (\(env.preferences.t("跟随系统", en: "Follow system")))"
            : env.preferences.resolvedLocale.identifier
        return [
            (env.preferences.t("版本", en: "Version"), "v\(version)"),
            (env.preferences.t("构建", en: "Build"), build),
            (env.preferences.t("客户端", en: "Client"), env.preferences.t("移动应用", en: "Mobile app")),
            (env.preferences.t("系统", en: "System"), "iOS"),
            (env.preferences.t("系统版本", en: "System version"), UIDevice.current.systemVersion),
            (env.preferences.t("语言", en: "Language"), language),
            (env.preferences.t("时区", en: "Time zone"), TimeZone.current.identifier),
            (env.preferences.t("安装形态", en: "Mode"), env.preferences.t("原生 SwiftUI 应用", en: "Native SwiftUI app")),
        ]
    }

    private var cloudSystemInfoItems: [(label: String, value: String)] {
        var items: [(label: String, value: String)] = [
            (env.preferences.t("实例版本", en: "Instance version"), instanceVersion.map { "v\($0.replacingOccurrences(of: "^v", with: "", options: .regularExpression))" } ?? unknownSystemInfoValue),
            (env.preferences.t("实例构建", en: "Instance build"), instanceHealth?.build ?? unknownSystemInfoValue),
            (env.preferences.t("数据库版本", en: "Database version"), instanceHealth?.migration ?? unknownSystemInfoValue),
            (env.preferences.t("数据库后端", en: "Database backend"), databaseBackendLabel(instanceHealth?.storage?.database)),
            (env.preferences.t("新上传对象存储", en: "New upload object storage"), objectStorageLabel(instanceHealth)),
        ]
        if instanceHealth?.objectStorageProvider == "s3" {
            items.append((
                env.preferences.t("已有附件", en: "Existing attachments"),
                env.preferences.t("继续从原存储读取", en: "Read from original storage")
            ))
        }
        items.append((
            env.preferences.t("部署平台", en: "Deployment platform"),
            deploymentPlatformLabel(instanceHealth?.runtime)
        ))
        if instanceHealth?.runtime == "self-hosted-bun" {
            items.append((
                env.preferences.t("容器镜像来源", en: "Container image source"),
                containerImageSourceLabel(instanceHealth?.containerImageSource)
            ))
        }
        return items
    }

    private var connectionSystemInfoItems: [(label: String, value: String)] {
        let queueItems = env.session.dataScope.flatMap { try? env.outbox.listItems(scope: $0) } ?? []
        let pending = queueItems.filter { $0.status == .pending || $0.status == .syncing }.count
        let failed = queueItems.filter { $0.status == .error || $0.status == .conflict }.count
        let connection = instanceHealth != nil
            ? env.preferences.t("连接正常", en: "Connected")
            : instanceDiagnosticsFailed
                ? env.preferences.t("连接失败", en: "Connection failed")
                : env.preferences.t("正在检查", en: "Checking")
        return [
            (env.preferences.t("实例连接", en: "Instance connection"), connection),
            (env.preferences.t("请求耗时", en: "Request latency"), instanceLatencyMilliseconds.map { "\($0) ms" } ?? unknownSystemInfoValue),
            (env.preferences.t("待同步", en: "Pending sync"), String(pending)),
            (env.preferences.t("失败或冲突", en: "Failed or conflicted"), String(failed)),
        ]
    }

    private var unknownSystemInfoValue: String {
        env.preferences.t("未知", en: "Unknown")
    }

    private func databaseBackendLabel(_ backend: String?) -> String {
        switch backend {
        case "d1": return "D1"
        case "sqlite": return "SQLite"
        case let value?: return value
        case nil: return unknownSystemInfoValue
        }
    }

    private func objectStorageLabel(_ health: InstanceHealth?) -> String {
        if health?.objectStorageProvider == "s3" {
            return env.preferences.t("第三方 S3 兼容 OSS", en: "Third-party S3-compatible OSS")
        }
        guard health?.objectStorageProvider == "builtin" else { return unknownSystemInfoValue }
        switch health?.storage?.resources {
        case "r2": return env.preferences.t("内置 R2", en: "Built-in R2")
        case "filesystem": return env.preferences.t("本地文件系统", en: "Local filesystem")
        case "s3": return env.preferences.t("实例内置 S3 兼容存储", en: "Instance-provided S3-compatible storage")
        default: return unknownSystemInfoValue
        }
    }

    private func deploymentPlatformLabel(_ runtime: String?) -> String {
        switch runtime {
        case "cloudflare-workers": return "Cloudflare"
        case "self-hosted-bun": return "Docker"
        default: return unknownSystemInfoValue
        }
    }

    private func containerImageSourceLabel(_ source: String?) -> String {
        switch source {
        case "official-ghcr": return "GitHub Container Registry (GHCR)"
        case "official-cn-mirror": return env.preferences.t("中国大陆官方镜像", en: "Official mainland China mirror")
        case "custom": return env.preferences.t("自定义镜像", en: "Custom image")
        default: return unknownSystemInfoValue
        }
    }

    private var systemInfoText: String {
        [
            systemInfoTextSection(env.preferences.t("云端实例", en: "Cloud instance"), items: cloudSystemInfoItems),
            systemInfoTextSection(env.preferences.t("当前客户端", en: "Current client"), items: clientSystemInfoItems),
            systemInfoTextSection(env.preferences.t("连接与同步", en: "Connection and sync"), items: connectionSystemInfoItems),
        ].joined(separator: "\n\n")
    }

    private func systemInfoTextSection(_ title: String, items: [(label: String, value: String)]) -> String {
        ([title] + items.map { "\($0.label): \($0.value)" }).joined(separator: "\n")
    }

    private func loadInstanceDiagnostics() async {
        guard env.session.isSignedIn else {
            instanceDiagnosticsFailed = true
            return
        }
        instanceDiagnosticsFailed = false
        let startedAt = Date()
        do {
            async let health = env.session.client.getInstanceHealth()
            async let release = env.session.client.getInstanceRelease()
            let (resolvedHealth, resolvedRelease) = try await (health, release)
            instanceHealth = resolvedHealth
            instanceVersion = resolvedRelease.version
            instanceLatencyMilliseconds = max(0, Int(Date().timeIntervalSince(startedAt) * 1_000))
        } catch {
            instanceHealth = nil
            instanceVersion = nil
            instanceLatencyMilliseconds = nil
            instanceDiagnosticsFailed = true
        }
    }

    private var feedbackURL: URL? {
        let english = env.preferences.isEnglish
        let heading = english ? "Feedback" : "反馈内容"
        let prompt = english
            ? "Describe the problem, steps to reproduce it, or the feature you would like to see."
            : "请描述遇到的问题、复现步骤，或你希望增加的功能。"
        let privacy = english
            ? "GitHub Issues are public. Do not include passwords, tokens, instance URLs, or private note content."
            : "GitHub Issue 公开可见，请勿提交密码、Token、实例地址或私人笔记内容。"
        let infoHeading = english ? "System information" : "系统信息"
        let notice = english
            ? "The following information was generated by EdgeEver to help diagnose the issue."
            : "以下信息由 EdgeEver 自动生成，可帮助定位问题。"
        let body = """
        ## \(heading)

        \(prompt)

        > \(privacy)

        ## \(infoHeading)

        \(notice)

        ```text
        \(systemInfoText)
        ```
        """
        var components = URLComponents(string: "https://github.com/tianma-if/edgeever/issues/new")
        components?.queryItems = [
            URLQueryItem(name: "title", value: english ? "[Feedback] " : "[反馈] "),
            URLQueryItem(name: "body", value: body),
        ]
        return components?.url
    }

    private func settingsGroup<Content: View>(
        title: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.accentStrong)
                Text(title)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(AppTheme.title)
            }
            .padding(16)
            content()
        }
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
            )
    }

    private func systemInfoGroup(
        title: String,
        description: String,
        icon: String,
        items: [(label: String, value: String)]
    ) -> some View {
        settingsGroup(title: title, icon: icon) {
            Text(description)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                infoRow(item.label, item.value, showBorder: true)
            }
        }
    }

    private func preferenceBlock<Content: View>(
        title: String,
        description: String,
        showTopBorder: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AppTheme.title)
                Text(description)
                    .font(.system(size: 12))
                    .foregroundStyle(AppTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) {
            if showTopBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
            }
        }
    }

    private func infoRow(_ title: String, _ value: String, showBorder: Bool) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.title)
                .multilineTextAlignment(.trailing)
        }
        .padding(16)
        .overlay(alignment: .top) {
            if showBorder {
                Rectangle().fill(AppTheme.cardBorder).frame(height: 1)
            }
        }
    }
}

// MARK: - Password panel (Android AccountSecurityPanel)
