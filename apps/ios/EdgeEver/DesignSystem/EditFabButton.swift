import SwiftUI
import UIKit

/// UIKit pencil FAB — WKWebView routinely steals hits from SwiftUI buttons in overlays.
struct EditFabButton: UIViewRepresentable {
    var accessibilityLabel: String
    var action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: "pencil", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
        config.baseForegroundColor = .white
        config.baseBackgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0x04 / 255, green: 0x78 / 255, blue: 0x57 / 255, alpha: 1)
                : UIColor(red: 0x10 / 255, green: 0xB9 / 255, blue: 0x81 / 255, alpha: 1)
        }
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)
        button.configuration = config
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.2
        button.layer.shadowRadius = 8
        button.layer.shadowOffset = CGSize(width: 0, height: 4)
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityIdentifier = DetailMemoChrome.editFab
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        // Always on top of sibling UIKit views inside the same hierarchy.
        button.layer.zPosition = 10_000
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        button.accessibilityLabel = accessibilityLabel
    }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}
