import UIKit
import UniformTypeIdentifiers

/// Copies shared files into the App Group while the item provider still grants access.
class ShareViewController: UIViewController {
    private let appGroupId = "group.org.edgeever.mobile"
    private let hostScheme = "edgeever"
    private let payloadKey = "edgeever.share.payload"
    private let imageDirectoryName = "incoming-share-images"

    private var started = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        view.backgroundColor = .systemBackground
        Task { await handleShare() }
    }

    private func handleShare() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }
        do {
            for provider in items.flatMap({ $0.attachments ?? [] }) {
                if try await stageArchive(from: provider) {
                    finishArchiveShare()
                    return
                }
            }
        } catch {
            finishArchiveShare(error: error)
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

    private func stageArchive(from provider: NSItemProvider) async throws -> Bool {
        let identifier = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .zip) == true }
        let suggestedName = provider.suggestedName
        let suggestedZIP = (suggestedName as NSString?)?.pathExtension.lowercased() == "zip"
        let hasFileURL = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
        let genericData = provider.registeredTypeIdentifiers == [UTType.data.identifier]
        let expectsArchive = identifier != nil || suggestedZIP || genericData
        guard expectsArchive ||
            (hasFileURL && !provider.hasItemConformingToTypeIdentifier(UTType.image.identifier)) else { return false }

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
            let stage: (URL?, Error?) -> Void = { source, error in
                guard let source else {
                    if expectsArchive {
                        continuation.resume(throwing: error ?? WeChatArchiveError.invalidArchive)
                    } else {
                        continuation.resume(returning: false)
                    }
                    return
                }
                guard expectsArchive || source.pathExtension.lowercased() == "zip" else {
                    continuation.resume(returning: false)
                    return
                }
                do {
                    guard let directory = WeChatShareInbox.sharedDirectory else { throw CocoaError(.fileNoSuchFile) }
                    try WeChatShareInbox.stage(source, suggestedName: suggestedName, in: directory)
                    continuation.resume(returning: true)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            let loadFileURL = {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                    let url = (item as? URL) ?? (item as? Data)
                        .flatMap { String(data: $0, encoding: .utf8) }
                        .flatMap { URL(string: $0) }
                    stage(url, error)
                }
            }
            if let identifier {
                provider.loadInPlaceFileRepresentation(forTypeIdentifier: identifier) { source, _, error in
                    if source == nil && hasFileURL { loadFileURL() } else { stage(source, error) }
                }
            } else if hasFileURL {
                loadFileURL()
            } else {
                provider.loadInPlaceFileRepresentation(forTypeIdentifier: UTType.data.identifier) { source, _, error in
                    stage(source, error)
                }
            }
        }
    }

    private func finishArchiveShare(error: Error? = nil) {
        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
        let title: String
        let message: String
        if let error {
            title = chinese ? "无法接收聊天记录" : "Could not receive the chat"
            if case WeChatArchiveError.insufficientSpace = error {
                message = chinese ? "手机存储空间不足。请释放一些空间后重新分享。" :
                    "Free up some space on your iPhone, then share the chat again."
            } else {
                message = chinese ? "无法复制聊天压缩包，请从微信重新分享。" :
                    "The archive could not be copied. Share the chat from WeChat again."
            }
        } else {
            title = chinese ? "聊天记录已接收" : "Chat received"
            message = chinese ? "打开 EdgeEver 后会自动导入为笔记。" :
                "Open EdgeEver to import the chat as a note."
        }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: chinese ? "完成" : "Done", style: .default) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        present(alert, animated: true)
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
