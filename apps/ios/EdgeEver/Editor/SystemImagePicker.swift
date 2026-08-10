import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - System PHPicker

enum ImagePickerResult {
    case cancelled
    case failed(String)
    case picked(Data, filename: String)
}

/// UIKit PHPicker wrapper — loads UIImage/data via NSItemProvider (not Transferable).
struct SystemImagePicker: UIViewControllerRepresentable {
    var onFinish: (ImagePickerResult) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 1
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onFinish: (ImagePickerResult) -> Void
        private var settled = false

        init(onFinish: @escaping (ImagePickerResult) -> Void) {
            self.onFinish = onFinish
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !settled else { return }
            guard let provider = results.first?.itemProvider else {
                settled = true
                DispatchQueue.main.async { self.onFinish(.cancelled) }
                return
            }
            Task {
                do {
                    let (data, name) = try await Self.loadImage(from: provider)
                    await MainActor.run {
                        guard !self.settled else { return }
                        self.settled = true
                        self.onFinish(.picked(data, filename: name))
                    }
                } catch {
                    await MainActor.run {
                        guard !self.settled else { return }
                        self.settled = true
                        self.onFinish(.failed(error.localizedDescription))
                    }
                }
            }
        }

        private static func loadImage(from provider: NSItemProvider) async throws -> (Data, String) {
            // 1) UIImage path — most reliable for Photos library assets.
            if provider.canLoadObject(ofClass: UIImage.self) {
                let image = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<UIImage, Error>) in
                    provider.loadObject(ofClass: UIImage.self) { object, error in
                        if let image = object as? UIImage {
                            cont.resume(returning: image)
                        } else {
                            cont.resume(
                                throwing: error
                                    ?? APIError(status: 0, code: nil, message: "无法解码图片")
                            )
                        }
                    }
                }
                if let data = image.jpegData(compressionQuality: 0.92), !data.isEmpty {
                    return (data, "image.jpg")
                }
            }

            // 2) Typed data representations.
            let typeIds = [
                UTType.jpeg.identifier,
                UTType.png.identifier,
                UTType.heic.identifier,
                UTType.image.identifier,
            ]
            for typeId in typeIds where provider.hasItemConformingToTypeIdentifier(typeId) {
                if let data = try? await loadData(provider, typeIdentifier: typeId), !data.isEmpty {
                    let normalized = ImagePickerData.normalize(data)
                    let mime = TipTapResourceLoader.sniffImageMime(normalized)
                    let ext = mime == "image/png" ? "png" : "jpg"
                    return (normalized, "image.\(ext)")
                }
            }

            throw APIError(status: 0, code: nil, message: "无法读取所选图片，请换一张重试。")
        }

        private static func loadData(_ provider: NSItemProvider, typeIdentifier: String) async throws -> Data {
            try await withCheckedThrowingContinuation { cont in
                provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, error in
                    if let data {
                        cont.resume(returning: data)
                    } else {
                        cont.resume(
                            throwing: error
                                ?? APIError(status: 0, code: nil, message: "读取图片数据失败")
                        )
                    }
                }
            }
        }
    }
}

enum ImagePickerData {
    /// HEIC / unknown → JPEG so upload mime is valid and ImageCompressor can decode.
    static func normalize(_ data: Data) -> Data {
        if data.starts(with: [0xFF, 0xD8, 0xFF]) { return data } // JPEG
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return data } // PNG
        if data.starts(with: [0x47, 0x49, 0x46, 0x38]) { return data } // GIF
        if data.count >= 12 {
            let riff = data.prefix(4)
            let webp = data.dropFirst(8).prefix(4)
            if riff.elementsEqual([0x52, 0x49, 0x46, 0x46]), webp.elementsEqual([0x57, 0x45, 0x42, 0x50]) {
                return data
            }
        }
        if let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.92) {
            return jpeg
        }
        return data
    }
}
