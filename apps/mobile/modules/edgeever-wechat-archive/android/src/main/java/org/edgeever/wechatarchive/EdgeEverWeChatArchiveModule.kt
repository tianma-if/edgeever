package org.edgeever.wechatarchive

import android.net.Uri
import android.system.ErrnoException
import android.system.OsConstants
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile

private const val TRANSCRIPT_NAME = "聊天记录.txt"
private const val MAX_EXPANDED_BYTES = 256L * 1024 * 1024
private const val MAX_TEXT_BYTES = 1024L * 1024
private const val MAX_ENTRIES = 1000
private const val MAX_DIRECTORY_BYTES = 8L * 1024 * 1024

private class ArchiveStorageException(cause: Throwable? = null) :
  CodedException("ERR_WECHAT_ARCHIVE_STORAGE", "Not enough space to extract the archive", cause)

private class ArchiveExpansionLimitException :
  CodedException("ERR_WECHAT_ARCHIVE_EXPANDED_SIZE", "The extracted archive would exceed 256 MiB", null)

class EdgeEverWeChatArchiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EdgeEverWeChatArchive")

    AsyncFunction("extract") { uriString: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)
      val archive = File(requireNotNull(uri.path)).canonicalFile
      require(uri.scheme == "file" && archive.parentFile == context.cacheDir.canonicalFile &&
        archive.name.matches(Regex("shared-wechat-[0-9a-f-]{36}\\.zip")) && archive.isFile)
      checkZipDirectory(archive)
      extractArchive(archive)
    }
  }
}

private fun extractArchive(archive: File): Map<String, Any> = ZipFile(archive).use { zip ->
  require(zip.size() in 1..MAX_ENTRIES)
  val files = zip.entries().asSequence().filterNot { it.isDirectory }.toList()
  val names = HashSet<String>()
  var expanded = 0L
  for (entry in files) {
    require(entry.name.split('/').all { it.isNotEmpty() && it != "." && it != ".." } &&
      !entry.name.contains('\\') && !entry.name.contains('\u0000') && names.add(entry.name))
    require(entry.size >= 0)
    if (entry.size > MAX_EXPANDED_BYTES - expanded) throw ArchiveExpansionLimitException()
    expanded += entry.size
  }

  val transcript = files.first { it.name.substringAfterLast('/') == TRANSCRIPT_NAME && isChatFile(it) }
  require(transcript.size in 1..MAX_TEXT_BYTES)
  val text = ByteArrayOutputStream(transcript.size.toInt()).use { output ->
    copyChecked(zip, transcript, output)
    Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(output.toByteArray())).toString().removePrefix("\uFEFF")
  }
  require(text.isNotBlank())

  val mediaEntries = files.filter { it !== transcript && it.size > 0 && isChatFile(it) }
  val cacheRoot = requireNotNull(archive.parentFile)
  requireArchiveSpace(cacheRoot, mediaEntries.sumOf { it.size })
  val cache = File(cacheRoot, "wechat-import-${UUID.randomUUID()}")
  try {
    check(cache.mkdir())
    val media = mediaEntries.mapIndexed { index, entry ->
      // Generate the directories. Archive paths never determine where a file is written.
      val directory = File(cache, index.toString())
      check(directory.mkdir())
      val file = File(directory, entry.name.substringAfterLast('/'))
      file.outputStream().use { copyChecked(zip, entry, it, cacheRoot) }
      mapOf("name" to entry.name, "data" to Uri.fromFile(file).toString())
    }
    mapOf("transcript" to text, "media" to media, "cacheUri" to Uri.fromFile(cache).toString())
  } catch (error: Exception) {
    cache.deleteRecursively()
    val errno = (error.cause as? ErrnoException)?.errno
    if (errno == OsConstants.ENOSPC || errno == OsConstants.EDQUOT) throw ArchiveStorageException(error)
    throw error
  }
}

private fun isChatFile(entry: ZipEntry): Boolean {
  val base = entry.name.substringAfterLast('/')
  return base != ".DS_Store" && !base.startsWith("._") && !entry.name.startsWith("__MACOSX/")
}

private fun requireArchiveSpace(directory: File, bytes: Long) {
  if (bytes > directory.usableSpace) throw ArchiveStorageException()
}

private fun copyChecked(zip: ZipFile, entry: ZipEntry, output: OutputStream, diskDirectory: File? = null) {
  val crc = CRC32()
  var total = 0L
  zip.getInputStream(entry).use { input ->
    val buffer = ByteArray(256 * 1024)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      require(total <= entry.size)
      crc.update(buffer, 0, read)
      if (diskDirectory != null) requireArchiveSpace(diskDirectory, read.toLong())
      output.write(buffer, 0, read)
    }
  }
  require(total == entry.size && crc.value == entry.crc)
}

// ZipFile can allocate from the directory size before exposing any entries.
private fun checkZipDirectory(archive: File) = RandomAccessFile(archive, "r").use { file ->
  val endSize = 22
  val tailSize = minOf(file.length(), endSize + 65535L).toInt()
  val tailStart = file.length() - tailSize
  val tail = readZipRecord(file, tailStart, tailSize)
  for (end in (tailSize - endSize) downTo 0) {
    if (tail.getInt(end) != 0x06054b50 ||
      end + endSize + (tail.getShort(end + 20).toInt() and 0xffff) != tailSize) continue

    val entryCount = tail.getShort(end + 10).toLong() and 0xffffL
    val size = tail.getInt(end + 12).toLong() and 0xffffffffL
    val start = tail.getInt(end + 16).toLong() and 0xffffffffL
    require(tail.getInt(end + 4) == 0 && tail.getShort(end + 8) == tail.getShort(end + 10))
    val endPosition = tailStart + end
    val locatorPosition = endPosition - 20
    if (locatorPosition >= 0) {
      val locator = readZipRecord(file, locatorPosition, 20)
      if (locator.getInt(0) == 0x07064b50) {
        require(locator.getInt(4) == 0 && locator.getInt(16) == 1)
        val zip64Position = locator.getLong(8)
        require(zip64Position in 0..(locatorPosition - 56))
        val zip64 = readZipRecord(file, zip64Position, 56)
        require(zip64.getInt(0) == 0x06064b50 && zip64.getLong(4) == locatorPosition - zip64Position - 12)
        require(zip64.getLong(16) == 0L && zip64.getLong(24) == zip64.getLong(32))
        val zip64Count = zip64.getLong(32)
        val zip64Size = zip64.getLong(40)
        val zip64Start = zip64.getLong(48)
        require(entryCount == 0xffffL || entryCount == zip64Count)
        require(size == 0xffffffffL || size == zip64Size)
        require(start == 0xffffffffL || start == zip64Start)
        requireZipDirectoryBounds(zip64Count, zip64Size, zip64Start, zip64Position)
        return@use
      }
    }
    requireZipDirectoryBounds(entryCount, size, start, endPosition)
    return@use
  }
  throw IllegalArgumentException("Missing ZIP directory")
}

private fun readZipRecord(file: RandomAccessFile, offset: Long, size: Int): ByteBuffer {
  val bytes = ByteArray(size)
  file.seek(offset)
  file.readFully(bytes)
  return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
}

private fun requireZipDirectoryBounds(count: Long, size: Long, start: Long, end: Long) {
  require(count in 1..MAX_ENTRIES.toLong() && size in 1..MAX_DIRECTORY_BYTES && start >= 0 && start == end - size)
}
