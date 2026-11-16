import Foundation

/// Bounds ZIPFoundation's directory scan and validates offsets before iterating
/// entries. The library owns decompression and CRC calculation.
enum WeChatZipDirectory {
    static func checkedEntryCount(in url: URL) throws -> Int {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let end = try file.seekToEnd()
        let footerSize = 22
        let tailSize = Int(min(end, UInt64(footerSize + 65_535)))
        guard tailSize >= footerSize else { throw WeChatArchiveError.invalidArchive }
        let tailStart = end - UInt64(tailSize)
        let tail = try read(file, at: tailStart, count: tailSize)
        // ZIPFoundation uses the first footer signature found scanning backwards.
        guard let footer = (0...(tailSize - footerSize)).reversed().first(where: {
            tail.integer(at: $0, as: UInt32.self) == 0x06054b50
        }), footer + footerSize + Int(tail.integer(at: footer + 20, as: UInt16.self)) == tailSize,
              tail.integer(at: footer + 4, as: UInt32.self) == 0,
              tail.integer(at: footer + 8, as: UInt16.self) == tail.integer(at: footer + 10, as: UInt16.self)
        else { throw WeChatArchiveError.invalidArchive }

        var directoryEnd = tailStart + UInt64(footer)
        var count = UInt64(tail.integer(at: footer + 10, as: UInt16.self))
        var size = UInt64(tail.integer(at: footer + 12, as: UInt32.self))
        var start = UInt64(tail.integer(at: footer + 16, as: UInt32.self))
        if directoryEnd >= 76 {
            let records = try read(file, at: directoryEnd - 76, count: 76)
            if records.integer(at: 56, as: UInt32.self) == 0x07064b50 {
                directoryEnd -= 76
                guard records.integer(at: 0, as: UInt32.self) == 0x06064b50,
                      records.integer(at: 4, as: UInt64.self) == 44,
                      records.integer(at: 16, as: UInt64.self) == 0,
                      records.integer(at: 24, as: UInt64.self) == records.integer(at: 32, as: UInt64.self),
                      records.integer(at: 60, as: UInt32.self) == 0,
                      records.integer(at: 64, as: UInt64.self) == directoryEnd,
                      records.integer(at: 72, as: UInt32.self) == 1
                else { throw WeChatArchiveError.invalidArchive }
                count = records.integer(at: 32, as: UInt64.self)
                size = records.integer(at: 40, as: UInt64.self)
                start = records.integer(at: 48, as: UInt64.self)
            }
        }
        guard (1...1_000).contains(count), (1...8 * 1_024 * 1_024).contains(size),
              size <= directoryEnd, start == directoryEnd - size
        else { throw WeChatArchiveError.invalidArchive }

        let directory = try read(file, at: start, count: Int(size))
        var offset = 0
        for _ in 0..<count {
            guard directory.count - offset >= 46,
                  directory.integer(at: offset, as: UInt32.self) == 0x02014b50,
                  directory.integer(at: offset + 8, as: UInt16.self) & 1 == 0
            else { throw WeChatArchiveError.invalidArchive }
            let nameLength = Int(directory.integer(at: offset + 28, as: UInt16.self))
            let extraLength = Int(directory.integer(at: offset + 30, as: UInt16.self))
            let commentLength = Int(directory.integer(at: offset + 32, as: UInt16.self))
            let extraStart = offset + 46 + nameLength
            let extraEnd = extraStart + extraLength
            guard extraEnd + commentLength <= directory.count else { throw WeChatArchiveError.invalidArchive }

            // The decoder may compute a data-descriptor offset from these fields
            // while constructing Entry, before the extraction budget is checked.
            var extra = extraStart
            while extraEnd - extra >= 4 {
                let fieldSize = Int(directory.integer(at: extra + 2, as: UInt16.self))
                let fieldEnd = extra + 4 + fieldSize
                guard fieldEnd <= extraEnd else { throw WeChatArchiveError.invalidArchive }
                if directory.integer(at: extra, as: UInt16.self) == 1 {
                    for value in stride(from: extra + 4, to: fieldEnd - 7, by: 8) {
                        guard directory.integer(at: value, as: UInt64.self) <= max(start, 256 * 1_024 * 1_024) else {
                            throw WeChatArchiveError.invalidArchive
                        }
                    }
                }
                extra = fieldEnd
            }
            offset = extraEnd + commentLength
        }
        guard offset == directory.count else { throw WeChatArchiveError.invalidArchive }
        return Int(count)
    }

    private static func read(_ file: FileHandle, at offset: UInt64, count: Int) throws -> Data {
        try file.seek(toOffset: offset)
        guard let bytes = try file.read(upToCount: count), bytes.count == count else {
            throw WeChatArchiveError.invalidArchive
        }
        return bytes
    }
}

private extension Data {
    func integer<T: FixedWidthInteger>(at offset: Int, as _: T.Type) -> T {
        withUnsafeBytes { T(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: T.self)) }
    }
}
