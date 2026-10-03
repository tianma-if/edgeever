import SwiftUI

/// Android `WorkspaceSettingsView` parity: full-height “我的” content above the shared bottom navigation.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.colorScheme) private var colorScheme
    let onClose: () -> Void

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
                    onClose()
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
                        Button(env.preferences.t("跟随系统", en: "System", ja: "システムに合わせる")) { env.preferences.localeCode = "system" }
                        Button("简体中文") { env.preferences.localeCode = "zh-CN" }
                        Button("English") { env.preferences.localeCode = "en-US" }
                        Button("日本語") { env.preferences.localeCode = "ja" }
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

                preferenceBlock(
                    title: env.preferences.t("父笔记本中显示子笔记本笔记", en: "Show notes from sub-notebooks", ja: "サブノートブックのノートを表示"),
                    showTopBorder: true
                ) {
                    Toggle("", isOn: Bindable(env.preferences).showDescendantNotes)
                        .labelsHidden()
                        .tint(AppTheme.accent)
                        .accessibilityLabel(env.preferences.t(
                            "是否在父笔记本中显示子笔记本中的笔记",
                            en: "Show notes from sub-notebooks in parent notebooks",
                            ja: "親ノートブックにサブノートブックのノートを表示する"
                        ))
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
                        onClose()
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
                items: cloudSystemInfoItems,
                notice: clientAheadOfInstanceNotice
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
        case "ja": return "日本語"
        default: return env.preferences.t("跟随系统", en: "System", ja: "システムに合わせる")
        }
    }

    private var clientAheadOfInstanceNotice: String? {
        let clientVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        guard let clientVersion, let instanceVersion, Self.isClient(clientVersion, aheadOfInstance: instanceVersion) else {
            return nil
        }
        switch instanceHealth?.runtime {
        case "cloudflare-workers":
            return env.preferences.t(
                "当前客户端版本高于云端实例。可等待每天自动更新，或手动运行 Update deployed EdgeEver 工作流。",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run the Update deployed EdgeEver workflow."
            )
        case "self-hosted-bun":
            return env.preferences.t(
                "当前客户端版本高于云端实例。可等待每天自动更新，或在安装目录执行 ./update.sh（默认 ~/edgeever）。",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or run ./update.sh in the install directory (default ~/edgeever)."
            )
        default:
            return env.preferences.t(
                "当前客户端版本高于云端实例。可等待每天自动更新，也可手动更新实例。",
                en: "This client is newer than the connected cloud instance. You can wait for the daily automatic instance update, or update the instance manually."
            )
        }
    }

    private static func isClient(_ clientVersion: String, aheadOfInstance instanceVersion: String) -> Bool {
        func core(_ value: String) -> [Int]? {
            let pattern = #"^v?(\d+)\.(\d+)\.(\d+)"#
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
            let range = NSRange(value.startIndex..., in: value)
            guard let match = regex.firstMatch(in: value, range: range) else { return nil }
            let numbers = (1...3).compactMap { index -> Int? in
                guard let part = Range(match.range(at: index), in: value) else { return nil }
                return Int(value[part])
            }
            return numbers.count == 3 ? numbers : nil
        }
        guard let client = core(clientVersion), let instance = core(instanceVersion) else { return false }
        for index in 0..<3 where client[index] != instance[index] {
            return client[index] > instance[index]
        }
        return false
    }

    private struct SystemInfoItem {
        let label: String
        let value: String
        var localOnly = false
    }

    private var currentClientDisplaySize: String {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let screen = scene?.screen ?? UIScreen.main
        let screenWidth = Int(screen.bounds.width.rounded())
        let screenHeight = Int(screen.bounds.height.rounded())
        guard screenWidth > 0, screenHeight > 0, screen.scale > 0 else {
            return env.preferences.t("未知", en: "Unknown")
        }
        let screenText = "\(screenWidth)×\(screenHeight)"
        let dpr = Self.formatDevicePixelRatio(screen.scale)
        return env.preferences.t(
            "\(screenText) @\(dpr)x",
            en: "\(screenText) @\(dpr)x",
            ja: "\(screenText) @\(dpr)x"
        )
    }

    private static func formatDevicePixelRatio(_ value: CGFloat) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == CGFloat(Int(rounded)) {
            return String(Int(rounded))
        }
        return String(format: "%g", Double(rounded))
    }

    private var currentDeviceModel: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) {
                String(cString: $0)
            }
        }
        let trimmed = machine.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? env.preferences.t("未知", en: "Unknown") : trimmed
    }

    private var clientSystemInfoItems: [SystemInfoItem] {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
        let language = env.preferences.localeCode == "system"
            ? "\(env.preferences.resolvedLocale.identifier) (\(env.preferences.t("跟随系统", en: "Follow system")))"
            : env.preferences.resolvedLocale.identifier
        return [
            SystemInfoItem(label: env.preferences.t("版本", en: "Version"), value: "v\(version)"),
            SystemInfoItem(label: env.preferences.t("构建", en: "Build"), value: build),
            SystemInfoItem(label: env.preferences.t("客户端", en: "Client"), value: env.preferences.t("移动应用", en: "Mobile app")),
            SystemInfoItem(label: env.preferences.t("系统", en: "System"), value: "iOS"),
            SystemInfoItem(label: env.preferences.t("系统版本", en: "System version"), value: UIDevice.current.systemVersion),
            SystemInfoItem(
                label: env.preferences.t("设备型号", en: "Device model", ja: "機種"),
                value: currentDeviceModel
            ),
            SystemInfoItem(
                label: env.preferences.t("屏幕分辨率", en: "Screen resolution", ja: "画面解像度"),
                value: currentClientDisplaySize
            ),
            SystemInfoItem(label: env.preferences.t("语言", en: "Language"), value: language),
            SystemInfoItem(label: env.preferences.t("时区", en: "Time zone"), value: TimeZone.current.identifier),
            SystemInfoItem(label: env.preferences.t("安装形态", en: "Mode"), value: env.preferences.t("原生 SwiftUI 应用", en: "Native SwiftUI app")),
        ]
    }

    private var cloudSystemInfoItems: [SystemInfoItem] {
        var items: [SystemInfoItem] = []
        if let instanceURL = env.session.session?.baseUrl, !instanceURL.isEmpty {
            items.append(SystemInfoItem(
                label: env.preferences.t("实例地址", en: "Instance URL", ja: "インスタンス URL"),
                value: instanceURL,
                localOnly: true
            ))
        }
        items.append(contentsOf: [
            SystemInfoItem(
                label: env.preferences.t("实例版本", en: "Instance version"),
                value: instanceVersion.map { "v\($0.replacingOccurrences(of: "^v", with: "", options: .regularExpression))" } ?? unknownSystemInfoValue
            ),
            SystemInfoItem(label: env.preferences.t("实例构建", en: "Instance build"), value: instanceHealth?.build ?? unknownSystemInfoValue),
            SystemInfoItem(
                label: env.preferences.t("实例部署时间", en: "Instance deployment time", ja: "インスタンスのデプロイ時刻"),
                value: deploymentVersionTimeLabel(instanceHealth?.deploymentVersionCreatedAt)
            ),
            SystemInfoItem(label: env.preferences.t("数据库版本", en: "Database version"), value: instanceHealth?.migration ?? unknownSystemInfoValue),
            SystemInfoItem(label: env.preferences.t("数据库后端", en: "Database backend"), value: databaseBackendLabel(instanceHealth?.storage?.database)),
            SystemInfoItem(label: env.preferences.t("新上传对象存储", en: "New upload object storage"), value: objectStorageLabel(instanceHealth)),
        ])
        if instanceHealth?.objectStorageProvider == "s3" {
            items.append(SystemInfoItem(
                label: env.preferences.t("已有附件", en: "Existing attachments"),
                value: env.preferences.t("继续从原存储读取", en: "Read from original storage")
            ))
        }
        items.append(SystemInfoItem(
            label: env.preferences.t("部署平台", en: "Deployment platform"),
            value: deploymentPlatformLabel(instanceHealth?.runtime)
        ))
        if instanceHealth?.runtime == "self-hosted-bun" {
            items.append(SystemInfoItem(
                label: env.preferences.t("容器镜像来源", en: "Container image source"),
                value: containerImageSourceLabel(instanceHealth?.containerImageSource)
            ))
        }
        return items
    }

    private var connectionSystemInfoItems: [SystemInfoItem] {
        let queueItems = env.session.dataScope.flatMap { try? env.outbox.listItems(scope: $0) } ?? []
        let pending = queueItems.filter { $0.status == .pending || $0.status == .syncing }.count
        let failed = queueItems.filter { $0.status == .error || $0.status == .conflict }.count
        let connection = instanceHealth != nil
            ? env.preferences.t("连接正常", en: "Connected")
            : instanceDiagnosticsFailed
                ? env.preferences.t("连接失败", en: "Connection failed")
                : env.preferences.t("正在检查", en: "Checking")
        return [
            SystemInfoItem(label: env.preferences.t("实例连接", en: "Instance connection"), value: connection),
            SystemInfoItem(
                label: env.preferences.t("健康检查耗时", en: "Health check time", ja: "ヘルスチェック時間"),
                value: instanceLatencyMilliseconds.map { "\($0) ms" } ?? unknownSystemInfoValue
            ),
            SystemInfoItem(label: env.preferences.t("待同步", en: "Pending sync"), value: String(pending)),
            SystemInfoItem(label: env.preferences.t("失败或冲突", en: "Failed or conflicted"), value: String(failed)),
        ]
    }

    private var unknownSystemInfoValue: String {
        env.preferences.t("未知", en: "Unknown")
    }

    private func deploymentVersionTimeLabel(_ timestamp: String?) -> String {
        guard let timestamp else { return unknownSystemInfoValue }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = parser.date(from: timestamp) ?? ISO8601DateFormatter().date(from: timestamp)
        guard let parsed else { return unknownSystemInfoValue }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: parsed)
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
        systemInfoText(includeLocalOnly: true)
    }

    private func systemInfoText(includeLocalOnly: Bool) -> String {
        let keep: (SystemInfoItem) -> Bool = includeLocalOnly ? { _ in true } : { !$0.localOnly }
        return [
            systemInfoTextSection(env.preferences.t("云端实例", en: "Cloud instance"), items: cloudSystemInfoItems.filter(keep)),
            systemInfoTextSection(env.preferences.t("当前客户端", en: "Current client"), items: clientSystemInfoItems.filter(keep)),
            systemInfoTextSection(env.preferences.t("连接与同步", en: "Connection and sync"), items: connectionSystemInfoItems.filter(keep)),
        ].joined(separator: "\n\n")
    }

    private func systemInfoTextSection(_ title: String, items: [SystemInfoItem]) -> String {
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
        let info = systemInfoText(includeLocalOnly: false)
        let body = """
        ## \(heading)

        \(prompt)

        > \(privacy)

        ## \(infoHeading)

        \(notice)

        ```text
        \(info)
        ```
        """
        var components = URLComponents(string: "https://github.com/tianma-if/edgeever/issues/new")
        components?.queryItems = [
            URLQueryItem(name: "title", value: english ? "[Feedback] " : "[反馈] "),
            URLQueryItem(name: "body", value: body),
            URLQueryItem(name: "system-info", value: info),
            URLQueryItem(name: "client", value: "iOS"),
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
        items: [SystemInfoItem],
        notice: String? = nil
    ) -> some View {
        settingsGroup(title: title, icon: icon) {
            Text(description)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

            if let notice {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 11, weight: .semibold))
                    Text(notice)
                        .font(.system(size: 11))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(AppTheme.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }

            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                infoRow(item.label, item.value, showBorder: true)
            }
        }
    }

    private func preferenceBlock<Content: View>(
        title: String,
        description: String? = nil,
        showTopBorder: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AppTheme.title)
                if let description {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
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
                .textSelection(.enabled)
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
