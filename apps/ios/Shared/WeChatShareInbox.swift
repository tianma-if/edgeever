import Foundation

enum WeChatArchiveError: Error {
    case invalidArchive
    case insufficientSpace
    case expansionLimit
    case incompleteMemo
}

enum WeChatShareInbox {
    static let appGroupID = "group.org.edgeever.mobile"

    static var sharedDirectory: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("incoming-wechat-archives", isDirectory: true)
    }

    struct Item: Sendable {
        let directory: URL
        let archiveURL: URL
    }

    static func stage(_ source: URL, suggestedName: String?, in directory: URL) throws {
        guard source.isFileURL else { throw WeChatArchiveError.invalidArchive }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }

        try withStorageErrors {
            var coordinationError: NSError?
            var result: Result<Void, Error>?
            NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
                result = Result { try stageCoordinated(url, suggestedName: suggestedName, in: directory) }
            }
            if let coordinationError { throw coordinationError }
            guard let result else { throw WeChatArchiveError.invalidArchive }
            try result.get()
        }
    }

    private static func stageCoordinated(_ source: URL, suggestedName: String?, in directory: URL) throws {
        let fileManager = FileManager.default
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size > 0 else {
            throw WeChatArchiveError.invalidArchive
        }
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        guard try input.read(upToCount: 4) == Data([0x50, 0x4b, 0x03, 0x04]) else {
            throw WeChatArchiveError.invalidArchive
        }

        let id = UUID().uuidString
        let staging = directory.appendingPathComponent("\(id).pending", isDirectory: true)
        let ready = directory.appendingPathComponent(id, isDirectory: true)
        let fallbackName = source.pathExtension.lowercased() == "zip" ? source.lastPathComponent : "聊天记录.zip"
        let candidate = ((suggestedName ?? fallbackName) as NSString).lastPathComponent
        let stem = (candidate as NSString).pathExtension.lowercased() == "zip"
            ? (candidate as NSString).deletingPathExtension : candidate
        let name = String(decoding: stem.utf8.prefix(200), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let validName = !name.isEmpty && name != "." && name != ".." && !name.contains("/") && !name.contains("\0")
        let filename = "\(validName ? name : "聊天记录").zip"

        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try requireSpace(UInt64(size), at: directory)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: false)
        defer { try? fileManager.removeItem(at: staging) }
        try fileManager.copyItem(at: source, to: staging.appendingPathComponent(filename))
        // The app sees the item only after the complete file has been copied.
        try fileManager.moveItem(at: staging, to: ready)
    }

    static func next(in directory: URL) -> Item? {
        let fileManager = FileManager.default
        let entries = (try? fileManager.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey]
        )) ?? []
        let ready = entries.compactMap { url -> (URL, Date)? in
            guard let values = try? url.resourceValues(forKeys: [.creationDateKey, .isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true else { return nil }
            let created = values.creationDate ?? .distantPast
            if url.pathExtension == "pending", UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil,
               Date().timeIntervalSince(created) > 24 * 60 * 60 {
                try? fileManager.removeItem(at: url)
            }
            guard UUID(uuidString: url.lastPathComponent) != nil else { return nil }
            return (url, created)
        }.sorted { $0.1 < $1.1 }
        for (folder, _) in ready {
            guard let files = try? fileManager.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]
            ), let archive = files.first(where: { url in
                guard url.pathExtension.lowercased() == "zip",
                      let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else { return false }
                return values.isRegularFile == true && values.isSymbolicLink != true
            }) else { continue }
            return Item(directory: folder, archiveURL: archive)
        }
        return nil
    }

    static func requireSpace(_ bytes: UInt64, at directory: URL) throws {
        let values = try directory.resourceValues(forKeys: [.volumeAvailableCapacityKey])
        if let capacity = values.volumeAvailableCapacity, bytes > UInt64(max(0, capacity)) {
            throw WeChatArchiveError.insufficientSpace
        }
    }

    static func withStorageErrors<T>(_ operation: () throws -> T) throws -> T {
        do {
            return try operation()
        } catch {
            var underlying: NSError? = error as NSError
            while let current = underlying {
                if (current.domain == NSCocoaErrorDomain && current.code == NSFileWriteOutOfSpaceError)
                    || (current.domain == NSPOSIXErrorDomain && [Int(ENOSPC), Int(EDQUOT)].contains(current.code)) {
                    throw WeChatArchiveError.insufficientSpace
                }
                underlying = current.userInfo[NSUnderlyingErrorKey] as? NSError
            }
            throw error
        }
    }
}
