import { crc32, inflateRawSync } from "node:zlib"

export class InvalidBuildZip extends Error {
  constructor() {
    super("The Replica artifact is not a supported ZIP archive.")
    this.name = "InvalidBuildZip"
  }
}

interface Entry {
  path: string
  directory: boolean
  byteLength: number
  read(): Buffer
}

function requireZip(valid: unknown): asserts valid {
  if (!valid) throw new InvalidBuildZip()
}

/** Reads the small, single-disk ZIP format emitted by the artifact uploader, without extracting paths. */
export function readBuildZip(archive: Buffer, maxEntries: number, maxFileBytes: number): Entry[] {
  let end = archive.length - 22
  const searchStart = Math.max(0, end - 65_535)
  while (end >= searchStart) {
    if (
      archive.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + archive.readUInt16LE(end + 20) === archive.length
    )
      break
    end -= 1
  }
  requireZip(end >= searchStart)

  const count = archive.readUInt16LE(end + 10)
  const centralOffset = archive.readUInt32LE(end + 16)
  requireZip(
    count > 0 &&
      count <= maxEntries &&
      archive.readUInt16LE(end + 8) === count &&
      archive.readUInt32LE(end + 4) === 0 &&
      centralOffset + archive.readUInt32LE(end + 12) === end,
  )

  let central = centralOffset
  const entries: Entry[] = []
  const localRecords: { start: number; end: number }[] = []
  for (let index = 0; index < count; index += 1) {
    requireZip(central + 46 <= end && archive.readUInt32LE(central) === 0x02014b50)
    const flags = archive.readUInt16LE(central + 8)
    const method = archive.readUInt16LE(central + 10)
    const checksum = archive.readUInt32LE(central + 16)
    const compressed = archive.readUInt32LE(central + 20)
    const byteLength = archive.readUInt32LE(central + 24)
    const nameLength = archive.readUInt16LE(central + 28)
    const nameStart = central + 46
    const next =
      nameStart +
      nameLength +
      archive.readUInt16LE(central + 30) +
      archive.readUInt16LE(central + 32)
    const attributes = archive.readUInt32LE(central + 38)
    const local = archive.readUInt32LE(central + 42)
    requireZip(
      nameLength > 0 &&
        next <= end &&
        byteLength <= maxFileBytes &&
        archive.readUInt16LE(central + 34) === 0 &&
        (flags & ~0x080e) === 0 &&
        (method === 8 || (method === 0 && compressed === byteLength)) &&
        local + 30 <= centralOffset &&
        archive.readUInt32LE(local) === 0x04034b50,
    )
    const name = archive.subarray(nameStart, nameStart + nameLength)
    const path = name.toString("latin1")
    const directory = path.endsWith("/")
    const unixType = attributes >>> 28
    requireZip(
      (unixType === 0 || unixType === (directory ? 4 : 8)) &&
        ((attributes & 0x10) === 0 || directory) &&
        (!directory || byteLength === 0) &&
        archive.readUInt16LE(local + 6) === flags &&
        archive.readUInt16LE(local + 8) === method &&
        archive.readUInt16LE(local + 26) === nameLength,
    )

    const dataStart = local + 30 + nameLength + archive.readUInt16LE(local + 28)
    const dataEnd = dataStart + compressed
    requireZip(
      dataEnd <= centralOffset &&
        archive.subarray(local + 30, local + 30 + nameLength).equals(name),
    )
    let recordEnd = dataEnd
    if (flags & 8) {
      requireZip(recordEnd + 12 <= centralOffset)
      if (archive.readUInt32LE(recordEnd) === 0x08074b50) recordEnd += 4
      requireZip(
        recordEnd + 12 <= centralOffset &&
          archive.readUInt32LE(recordEnd) === checksum &&
          archive.readUInt32LE(recordEnd + 4) === compressed &&
          archive.readUInt32LE(recordEnd + 8) === byteLength,
      )
      recordEnd += 12
    } else {
      requireZip(
        archive.readUInt32LE(local + 14) === checksum &&
          archive.readUInt32LE(local + 18) === compressed &&
          archive.readUInt32LE(local + 22) === byteLength,
      )
    }

    localRecords.push({ start: local, end: recordEnd })
    entries.push({
      path: directory ? path.slice(0, -1) : path,
      directory,
      byteLength,
      read() {
        const data = archive.subarray(dataStart, dataEnd)
        let output = data
        if (method === 8) {
          try {
            const result = inflateRawSync(data, {
              info: true,
              maxOutputLength: Math.max(1, byteLength),
            }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
            requireZip(result.engine.bytesWritten === compressed)
            output = result.buffer
          } catch {
            throw new InvalidBuildZip()
          }
        }
        requireZip(output.length === byteLength && crc32(output) === checksum)
        return output
      },
    })
    central = next
  }
  requireZip(central === end)
  let previousEnd = 0
  for (const record of localRecords.sort((a, b) => a.start - b.start)) {
    requireZip(record.start === previousEnd)
    previousEnd = record.end
  }
  requireZip(previousEnd === centralOffset)
  return entries
}
