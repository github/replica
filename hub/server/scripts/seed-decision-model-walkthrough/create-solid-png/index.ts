import { deflateSync } from "node:zlib"

export function createSolidPng(width: number, height: number, color: number[]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.alloc(width * 3 + 1)
  for (let offset = 1; offset < row.length; offset += 3) {
    row[offset] = color[0] ?? 0
    row[offset + 1] = color[1] ?? 0
    row[offset + 2] = color[2] ?? 0
  }
  const image = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", image), chunk("IEND")])
}

function chunk(type: string, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}
