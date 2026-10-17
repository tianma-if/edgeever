import Foundation

struct MemoTemplate: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var description: String?
    var title: String?
    var contentMarkdown: String
    var tags: [String]
    var createdAt: String
    var updatedAt: String
}

struct TemplatesResponse: Codable, Sendable {
    var templates: [MemoTemplate]
}

/// Optional template from the server's gallery; it is not saved in the workspace.
struct MemoTemplateGalleryEntry: Codable, Equatable, Sendable {
    var key: String
    var name: String
    var description: String
    var title: String
    var contentMarkdown: String
    var tags: [String]
}

struct TemplateGalleryResponse: Codable, Sendable {
    var templates: [MemoTemplateGalleryEntry]
}

struct CreateMemoSeed: Equatable, Sendable {
    var title: String
    var contentMarkdown: String
    var tagsText: String

    var hasContent: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !tagsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct SelectableMemoTemplate: Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var description: String
    var title: String
    var contentMarkdown: String
    var tags: [String]

    init(_ template: MemoTemplate) {
        id = template.id
        name = template.name
        description = template.description ?? ""
        title = template.title ?? template.name
        contentMarkdown = template.contentMarkdown
        tags = template.tags
    }

    init(_ entry: MemoTemplateGalleryEntry) {
        id = "gallery:\(entry.key)"
        name = entry.name
        description = entry.description
        title = entry.title
        contentMarkdown = entry.contentMarkdown
        tags = entry.tags
    }

    var createSeed: CreateMemoSeed {
        CreateMemoSeed(
            title: title,
            contentMarkdown: contentMarkdown,
            tagsText: tags.joined(separator: ", ")
        )
    }
}
