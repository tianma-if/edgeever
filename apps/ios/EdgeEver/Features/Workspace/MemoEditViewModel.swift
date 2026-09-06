import Foundation
import Observation

@MainActor
@Observable
final class MemoEditViewModel {
    static let emptyDocJSON = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}"

    var title = ""
    var tagsText = ""
    var notebookId = ""
    var contentMarkdown = ""
    var contentJSON = MemoEditViewModel.emptyDocJSON
    var expectedRevision: Int?
    var expectedContentHash: String?
    var memoId: String?
    var error: String?
    var editGeneration: UInt64 = 0
    var isMaterializing = false
    var isDirty = false
    var isSaving = false
    var isCreating = false
    var isUploading = false
    var editorReady = false
    var suppressPersistence = false
    var contentHydrated = false
    var baselineMarkdown = ""
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    var tags: [String] {
        var seen = Set<String>()
        return tagsText
            .split(whereSeparator: { $0 == "," || $0 == "，" || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "^#", with: "", options: .regularExpression) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
            .prefix(24)
            .map { $0 }
    }

    func markDirty() {
        guard !suppressPersistence else { return }
        editGeneration &+= 1
        isDirty = true
    }

    func scheduleSave(
        delayNanoseconds: UInt64 = 500_000_000,
        operation: @escaping @MainActor () async -> Void
    ) {
        guard !suppressPersistence else { return }
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard !Task.isCancelled, !suppressPersistence else { return }
            await operation()
        }
    }

    func cancelScheduledSave() {
        saveTask?.cancel()
        saveTask = nil
    }

    func drainScheduledSave(operation: @escaping @MainActor () async -> Void) async {
        let pendingSave = saveTask
        saveTask = nil
        pendingSave?.cancel()
        await pendingSave?.value
        saveTask?.cancel()
        saveTask = nil
        if isDirty {
            await operation()
        }
    }

    func makeDraft(key: String, expectedRevision: Int?, updatedAt: String) -> MemoDraft {
        MemoDraft(
            draftKey: key,
            title: title,
            contentMarkdown: contentMarkdown,
            contentJson: contentJSON,
            notebookId: notebookId,
            tagsText: tagsText,
            expectedRevision: expectedRevision,
            updatedAt: updatedAt
        )
    }

    func performCreateCommit<T>(
        operation: @escaping @MainActor () async throws -> T
    ) async -> T? {
        guard !isCreating else { return nil }
        isCreating = true
        suppressPersistence = true
        isDirty = false
        cancelScheduledSave()
        defer { isCreating = false }
        do {
            return try await operation()
        } catch {
            suppressPersistence = false
            self.error = error.localizedDescription
            return nil
        }
    }

    func performUpload(
        operation: @escaping @MainActor () async throws -> Void
    ) async -> Bool {
        guard !isUploading else { return false }
        isUploading = true
        error = nil
        defer { isUploading = false }
        do {
            try await operation()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func applyEditorPayload(markdown: String, json: String) {
        let previousText = EditorContentCodec.plainText(markdown: contentMarkdown, json: contentJSON)
        let trimmedJSON = json.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextJSON = !trimmedJSON.isEmpty && EditorContentCodec.looksLikeTipTapDoc(trimmedJSON)
            ? trimmedJSON
            : contentJSON
        let nextMarkdown = EditorContentCodec.preferredMarkdown(
            editorMarkdown: markdown,
            documentJSON: nextJSON,
            fallback: contentMarkdown
        )
        let nextText = EditorContentCodec.plainText(markdown: nextMarkdown, json: nextJSON)
        let nextHasImage = EditorContentCodec.containsImageNode(nextJSON) || nextMarkdown.contains("![")

        guard previousText.count < 8 || nextText.count >= max(4, previousText.count / 2) || !nextHasImage else {
            NSLog(
                "MemoEditViewModel: reject text-stripping payload prevText=%d nextText=%d",
                previousText.count,
                nextText.count
            )
            return
        }

        contentJSON = nextJSON
        contentMarkdown = nextMarkdown
    }

    func wouldClobberNonEmptyBody(isCreate: Bool) -> Bool {
        guard !isCreate else { return false }
        let next = contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = baselineMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
        if next.isEmpty && !base.isEmpty { return true }

        let baseText = EditorContentCodec.plainTextFromMarkdown(baselineMarkdown)
        let nextText = EditorContentCodec.plainText(markdown: contentMarkdown, json: contentJSON)
        let nextHasImage = contentMarkdown.contains("/api/v1/resources/")
            || contentJSON.contains("/api/v1/resources/")
            || contentJSON.contains("\"type\":\"image\"")
        return baseText.count >= 8 && nextText.count < max(4, baseText.count / 2) && nextHasImage
    }

    func reconcileMarkdownWithJSON() {
        guard contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let recovered = EditorContentCodec.markdownFromTipTapJSON(contentJSON)
        else { return }
        contentMarkdown = recovered
    }

    func ensureImageInContent(imageSrc: String, alt: String) {
        if EditorContentCodec.jsonContainsResource(contentJSON, src: imageSrc) {
            reconcileMarkdownWithJSON()
            return
        }
        contentJSON = EditorContentCodec.appendingImage(toJSON: contentJSON, src: imageSrc, alt: alt)
        if !contentMarkdown.contains(imageSrc) {
            let separator = contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\n\n"
            contentMarkdown += "\(separator)![\(alt)](\(imageSrc))\n"
        }
    }
}
