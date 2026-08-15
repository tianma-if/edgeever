import Foundation

/// Reads share payloads written by Share Extension via App Group.
@MainActor
final class ShareHandoffStore {
    static let appGroupId = "group.org.edgeever.mobile"
    static let payloadKey = "edgeever.share.payload"
    static let imageDirectoryName = "incoming-share-images"

    struct SharePayload: Codable, Equatable {
        var text: String?
        var url: String?
        var title: String?
        var imageFilename: String? = nil
        var imageMimeType: String? = nil
        var imageOriginalName: String? = nil
    }

    struct SharedImage: Equatable, Identifiable {
        var fileURL: URL
        var filename: String
        var mimeType: String

        var id: URL { fileURL }
    }

    func consumePending() -> [SharePayload] {
        guard let defaults = UserDefaults(suiteName: Self.appGroupId) else { return [] }
        guard let data = defaults.data(forKey: Self.payloadKey) else { return [] }
        defaults.removeObject(forKey: Self.payloadKey)
        if let typed = try? EdgeEverJSON.decoder.decode([SharePayload].self, from: data) {
            return typed
        }
        // Share extension may write JSONSerialization dictionaries with optional nulls.
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return raw.map { dict in
            SharePayload(
                text: dict["text"] as? String,
                url: dict["url"] as? String,
                title: dict["title"] as? String,
                imageFilename: dict["imageFilename"] as? String,
                imageMimeType: dict["imageMimeType"] as? String,
                imageOriginalName: dict["imageOriginalName"] as? String
            )
        }
    }

    func sharedImages(from payloads: [SharePayload]) -> [SharedImage] {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupId
        ) else { return [] }
        let directory = container.appendingPathComponent(Self.imageDirectoryName, isDirectory: true)
        return Self.sharedImages(from: payloads, directory: directory)
    }

    static func sharedImages(from payloads: [SharePayload], directory: URL) -> [SharedImage] {
        payloads.compactMap { payload in
            guard let storedName = payload.imageFilename?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !storedName.isEmpty,
                  storedName != ".",
                  storedName != "..",
                  (storedName as NSString).lastPathComponent == storedName
            else { return nil }
            let safeDirectory = directory.standardizedFileURL
            let fileURL = safeDirectory.appendingPathComponent(storedName, isDirectory: false).standardizedFileURL
            guard fileURL.deletingLastPathComponent() == safeDirectory else { return nil }
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
            let originalName = payload.imageOriginalName?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let mimeType = payload.imageMimeType?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return SharedImage(
                fileURL: fileURL,
                filename: originalName.flatMap { $0.isEmpty ? nil : $0 } ?? storedName,
                mimeType: mimeType.flatMap { $0.isEmpty ? nil : $0 } ?? "image/jpeg"
            )
        }
    }

    func removeImage(_ image: SharedImage) {
        try? FileManager.default.removeItem(at: image.fileURL)
    }

    static func writeForExtension(_ payloads: [SharePayload]) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        guard let data = try? EdgeEverJSON.encoder.encode(payloads) else { return }
        defaults.set(data, forKey: payloadKey)
    }
}
