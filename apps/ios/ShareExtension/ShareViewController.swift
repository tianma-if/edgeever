import UIKit
import UniformTypeIdentifiers

/// Lightweight share extension: text, web URLs, and images → App Group → open main app.
class ShareViewController: UIViewController {
    private let appGroupId = "group.org.edgeever.mobile"
    private let hostScheme = "edgeever"
    private let payloadKey = "edgeever.share.payload"
    private let imageDirectoryName = "incoming-share-images"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        Task { await handleShare() }
    }

    private func handleShare() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }
        var payload: [[String: Any]] = []

        for item in items {
            let title = item.attributedContentText?.string
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                   let image = try? await persistImage(from: provider)
                {
                    payload.append([
                        "imageFilename": image.storageFilename,
                        "imageMimeType": image.mimeType,
                        "imageOriginalName": image.originalName,
                        "title": title as Any,
                    ])
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
                {
                    payload.append(["url": url.absoluteString, "title": title as Any])
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let str = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
                {
                    payload.append(["text": str, "title": title as Any])
                }
            }
        }

        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let defaults = UserDefaults(suiteName: appGroupId)
        {
            defaults.set(data, forKey: payloadKey)
        }

        if let url = URL(string: "\(hostScheme)://share") {
            extensionContext?.open(url) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
            return
        }
        extensionContext?.completeRequest(returningItems: nil)
    }

    private func persistImage(from provider: NSItemProvider) async throws -> (
        storageFilename: String,
        originalName: String,
        mimeType: String
    ) {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let directory = container.appendingPathComponent(imageDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let typeIdentifier = provider.registeredTypeIdentifiers.first(where: {
            UTType($0)?.conforms(to: .image) == true
        }) ?? UTType.image.identifier
        let type = UTType(typeIdentifier)
        let preferredExtension = type?.preferredFilenameExtension ?? "jpg"
        let mimeType = type?.preferredMIMEType ?? "image/jpeg"
        let suggested = ((provider.suggestedName ?? "shared-image") as NSString).lastPathComponent
        let originalName = (suggested as NSString).pathExtension.isEmpty
            ? "\(suggested).\(preferredExtension)"
            : suggested
        let storageFilename = "\(UUID().uuidString).\(preferredExtension)"
        let destination = directory.appendingPathComponent(storageFilename, isDirectory: false)

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { source, error in
                    guard let source else {
                        continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                        return
                    }
                    do {
                        try FileManager.default.copyItem(at: source, to: destination)
                        continuation.resume(returning: ())
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        } catch {
            let data = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
                provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, error in
                    if let data, !data.isEmpty {
                        continuation.resume(returning: data)
                    } else {
                        continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                    }
                }
            }
            try data.write(to: destination, options: .atomic)
        }
        return (storageFilename, originalName, mimeType)
    }
}
