import { crc32, inflateRawSync } from "node:zlib"

import { ZipArchiveError } from "./errors.ts"
import type { ZipArchiveEntry, ZipArchiveLimits } from "./types.ts"

const endOfCentralDirectorySignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localHeaderSignature = 0x04034b50
const symbolicLinkMode = 0o120000
const fileTypeMask = 0o170000
const utf8 = new TextDecoder("utf-8", { fatal: true })

function findEndOfCentralDirectory(archive: Buffer) {
  const earliest = Math.max(0, archive.length - 22 - 0xffff)
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfCentralDirectorySignature) return offset
  }
  throw new ZipArchiveError("The package is not a ZIP archive.")
}

function decodeName(bytes: Buffer) {
  try {
    return utf8.decode(bytes)
  } catch {
    throw new ZipArchiveError("The package contains a file name that is not valid UTF-8.")
  }
}

/**
 * Reads regular files from a bounded, single-disk ZIP archive. Rejects ZIP64,
 * encryption, symbolic links, unsupported compression, duplicate names, and
 * entries whose size or checksum differs from the central directory.
 */
export function readZipArchive(archive: Buffer, limits: ZipArchiveLimits): ZipArchiveEntry[] {
  if (archive.length < 22) throw new ZipArchiveError("The package is not a ZIP archive.")
  const end = findEndOfCentralDirectory(archive)
  const disk = archive.readUInt16LE(end + 4)
  const directoryDisk = archive.readUInt16LE(end + 6)
  const diskEntries = archive.readUInt16LE(end + 8)
  const entryCount = archive.readUInt16LE(end + 10)
  const directorySize = archive.readUInt32LE(end + 12)
  const directoryOffset = archive.readUInt32LE(end + 16)
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new ZipArchiveError("ZIP64 packages are not supported.")
  }
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entryCount) {
    throw new ZipArchiveError("Multi-disk packages are not supported.")
  }
  if (entryCount > limits.maximumEntries) {
    throw new ZipArchiveError(`The package contains more than ${limits.maximumEntries} entries.`)
  }
  if (directoryOffset + directorySize > end) {
    throw new ZipArchiveError("The package central directory is invalid.")
  }

  const entries: ZipArchiveEntry[] = []
  const names = new Set<string>()
  let totalBytes = 0
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new ZipArchiveError("The package central directory is invalid.")
    }
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const checksum = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const size = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const entryDisk = archive.readUInt16LE(offset + 34)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const localOffset = archive.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > end) throw new ZipArchiveError("The package central directory is invalid.")
    const name = decodeName(archive.subarray(offset + 46, nameEnd))
    offset = nameEnd + extraLength + commentLength

    if (
      compressedSize === 0xffffffff ||
      size === 0xffffffff ||
      localOffset === 0xffffffff ||
      entryDisk !== 0
    ) {
      throw new ZipArchiveError("ZIP64 packages are not supported.")
    }
    if (flags & 0x1) throw new ZipArchiveError("Encrypted packages are not supported.")
    if (((externalAttributes >>> 16) & fileTypeMask) === symbolicLinkMode) {
      throw new ZipArchiveError("Packages may not contain symbolic links.")
    }
    if (name.endsWith("/")) continue
    if (method !== 0 && method !== 8) {
      throw new ZipArchiveError("The package uses an unsupported compression method.")
    }
    if (names.has(name)) throw new ZipArchiveError("The package contains duplicate file names.")
    names.add(name)
    const maximumBytes = limits.maximumEntryBytes(name)
    if (size > maximumBytes) throw new ZipArchiveError(`${name} exceeds its size limit.`)
    totalBytes += size
    if (totalBytes > limits.maximumTotalBytes) {
      throw new ZipArchiveError("The extracted package exceeds its size limit.")
    }

    if (
      localOffset + 30 > directoryOffset ||
      archive.readUInt32LE(localOffset) !== localHeaderSignature
    ) {
      throw new ZipArchiveError(`${name} has an invalid local header.`)
    }
    const dataStart =
      localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28)
    if (dataStart + compressedSize > directoryOffset) {
      throw new ZipArchiveError(`${name} extends beyond the package data.`)
    }
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)
    let bytes: Buffer
    try {
      bytes =
        method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) })
    } catch {
      throw new ZipArchiveError(`${name} could not be decompressed within its size limit.`)
    }
    if (bytes.length !== size || crc32(bytes) !== checksum) {
      throw new ZipArchiveError(`${name} does not match its recorded size or checksum.`)
    }
    entries.push({ name, bytes })
  }
  return entries
}
