import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { crc32, deflateRawSync } from "node:zlib"

async function listFiles(root, directory = "") {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)))
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`${relative} is not a regular file.`)
  }
  return files.sort()
}

/**
 * Zips a checked package directory with the same relative paths an uploaded artifact
 * uses. Package limits keep every archive far below the sizes that would need ZIP64.
 */
export async function createZipArchive(root) {
  const parts = []
  const centrals = []
  let offset = 0
  const files = await listFiles(root)
  for (const file of files) {
    const name = Buffer.from(file)
    const bytes = await readFile(path.join(root, file))
    const data = deflateRawSync(bytes)
    const checksum = crc32(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(bytes.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}
