import SwiftUI
import UIKit

/// Exact visual tokens from Android `workspace-styles.ts`.
enum AppTheme {
    // Surfaces
    static let background = Color(light: 0xF8FAFC, dark: 0x020617)
    static let card = Color(light: 0xFFFFFF, dark: 0x0F172A)
    static let cardElevated = Color(light: 0xFFFFFF, dark: 0x1E293B)
    static let cardBorder = Color(light: 0xF1F5F9, dark: 0x1E293B)
    static let border = Color(light: 0xE2E8F0, dark: 0x334155)
    static let searchFill = Color(light: 0xF1F5F9, dark: 0x1E293B)
    static let searchActiveFill = Color(light: 0xECFDF5, dark: 0x064E3B)
    static let disabledFill = Color(light: 0xCBD5E1, dark: 0x334155)
    static let disabledText = Color(light: 0xF8FAFC, dark: 0x94A3B8)
    static let sheetHandle = Color(light: 0xCBD5E1, dark: 0x475569)

    // Text
    static let title = Color(light: 0x0F172A, dark: 0xF8FAFC)
    static let body = Color(light: 0x0F172A, dark: 0xF8FAFC)
    static let secondary = Color(light: 0x64748B, dark: 0xCBD5E1)
    static let meta = Color(light: 0x334155, dark: 0xE2E8F0)
    static let muted = Color(light: 0x94A3B8, dark: 0x94A3B8)
    static let slate = Color(light: 0x475569, dark: 0xE2E8F0)
    static let filterActive = Color(light: 0x334155, dark: 0x475569)

    // Brand
    static let accent = Color(light: 0x059669, dark: 0x34D399)
    static let accentStrong = Color(light: 0x047857, dark: 0x6EE7B7)
    static let accentBright = Color(light: 0x10B981, dark: 0x34D399)
    static let accentSoft = Color(light: 0xECFDF5, dark: 0x064E3B)
    static let accentBorder = Color(light: 0xA7F3D0, dark: 0x047857)
    static let accentText = Color(light: 0x065F46, dark: 0xA7F3D0)
    static let danger = Color(light: 0xDC2626, dark: 0xFCA5A5)
    static let dangerStrong = Color(light: 0x9F1239, dark: 0xFDA4AF)
    static let accentAction = Color(light: 0x059669, dark: 0x047857)
    static let dangerAction = Color(light: 0xBE123C, dark: 0x9F1239)
    static let dangerSurface = Color(light: 0xFFF1F2, dark: 0x4C0519)
    static let dangerBorder = Color(light: 0xFECDD3, dark: 0x9F1239)
    static let infoAction = Color(light: 0x1D4ED8, dark: 0x2563EB)
    static let infoText = Color(light: 0x1E3A8A, dark: 0xBFDBFE)
    static let infoSurface = Color(light: 0xEFF6FF, dark: 0x172554)
    static let warningText = Color(light: 0xC2410C, dark: 0xFDBA74)
    static let warningSurface = Color(light: 0xFFF7ED, dark: 0x431407)

    // First-sync progress / error (Android memoSync* + memoListLoading* / memoListError*)
    static let syncProgressTrack = Color(light: 0xD1FAE5, dark: 0x065F46)
    static let syncProgressFill = Color(light: 0x059669, dark: 0x34D399)
    static let syncErrorBackground = Color(light: 0xFFFBEB, dark: 0x451A03)
    static let syncErrorBorder = Color(light: 0xFCD34D, dark: 0x92400E)
    static let syncErrorTitle = Color(light: 0x451A03, dark: 0xFEF3C7)
    static let syncErrorBody = Color(light: 0x92400E, dark: 0xFDE68A)
    static let syncErrorRetryFill = Color(light: 0xFEF3C7, dark: 0x78350F)
    static let emptyDashBorder = Color(light: 0xCBD5E1, dark: 0x475569)

    // Tag chip
    static let tagBackground = Color(light: 0xF1F5F9, dark: 0x1E293B)

    static let fabShadow = Color(light: 0x10B981, dark: 0x34D399).opacity(0.28)

    // Typography helpers matching RN sizes
    static let notebookTitleFont = Font.system(size: 17, weight: .bold)
    static let memoTitleFont = Font.system(size: 16, weight: .bold)
    static let memoExcerptFont = Font.system(size: 14)
    static let memoDateFont = Font.system(size: 12, weight: .medium)
    static let tagFont = Font.system(size: 12, weight: .medium)
    static let searchFont = Font.system(size: 14)
    static let bottomNavFont = Font.system(size: 11, weight: .bold)

    /// Android `fontWeight: "800"`.
    static let heavy = Font.Weight.heavy
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }

    init(light: UInt32, dark: UInt32, opacity: Double = 1) {
        self.init(uiColor: UIColor { traits in
            UIColor(
                hex: traits.userInterfaceStyle == .dark ? dark : light,
                opacity: opacity
            )
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: opacity
        )
    }
}
