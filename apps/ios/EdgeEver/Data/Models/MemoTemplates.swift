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

    var createSeed: CreateMemoSeed {
        CreateMemoSeed(
            title: title,
            contentMarkdown: contentMarkdown,
            tagsText: tags.joined(separator: ", ")
        )
    }
}
