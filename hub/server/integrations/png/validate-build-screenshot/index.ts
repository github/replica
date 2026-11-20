import { Readable } from "node:stream"
import { crc32, createInflate } from "node:zlib"

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const colors = new Map([
  [0, { channels: 1, depths: [1, 2, 4, 8, 16] }],
  [2, { channels: 3, depths: [8, 16] }],
  [3, { channels: 1, depths: [1, 2, 4, 8] }],
  [4, { channels: 2, depths: [8, 16] }],
  [6, { channels: 4, depths: [8, 16] }],
])
const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const

/** Checks a complete PNG stream without allocating its full decoded image. */
export async function validateBuildScreenshot(bytes: Buffer, width: number, minHeight: number) {
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("latin1", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== width
  )
    return false
  const height = bytes.readUInt32BE(20)
  const depth = bytes.readUInt8(24)
  const colorType = bytes.readUInt8(25)
  const color = colors.get(colorType)
  const interlace = bytes.readUInt8(28)
  if (
    height < minHeight ||
    height > 16_384 ||
    !color?.depths.includes(depth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    interlace > 1
  )
    return false

  const chunks: Buffer[] = []
  let palette = false
  let closedData = false
  let ended = false
  let chunkCount = 0
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const dataEnd = offset + 8 + length
    const chunk = bytes.toString("latin1", offset + 4, offset + 8)
    if (
      ++chunkCount > 16_384 ||
      dataEnd + 4 > bytes.length ||
      !/^[a-zA-Z]{2}[A-Z][a-zA-Z]$/.test(chunk) ||
      crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)
    )
      return false
    if (chunk === "IDAT") {
      if (closedData || (colorType === 3 && !palette)) return false
      chunks.push(bytes.subarray(offset + 8, dataEnd))
    } else {
      if (chunks.length) closedData = true
      if (chunk === "IEND") {
        ended = length === 0 && dataEnd + 4 === bytes.length
        break
      }
      if (chunk === "PLTE") {
        if (
          palette ||
          closedData ||
          colorType === 0 ||
          colorType === 4 ||
          length === 0 ||
          length % 3 ||
          length > 768 ||
          (colorType === 3 && length / 3 > 2 ** depth)
        )
          return false
        palette = true
      } else if (chunk === "IHDR" ? offset !== 8 : /^[A-Z]/.test(chunk)) {
        return false
      }
    }
    offset = dataEnd + 4
  }
  if (!ended || !chunks.length) return false

  const passes = (interlace ? adam7 : ([[0, 0, 1, 1]] as const)).flatMap(([x, y, dx, dy]) => {
    const columns = Math.ceil((width - x) / dx)
    const rows = Math.ceil((height - y) / dy)
    return columns > 0 && rows > 0
      ? [{ rows, stride: Math.ceil((columns * color.channels * depth) / 8) + 1 }]
      : []
  })
  const inflater = createInflate()
  const input = Readable.from(chunks).pipe(inflater)
  let pass = 0
  let row = 0
  let nextFilter = 0
  let decoded = 0
  const expected = passes.reduce((sum, { stride, rows }) => sum + stride * rows, 0)
  try {
    for await (const chunk of input as AsyncIterable<Buffer>) {
      const end = decoded + chunk.length
      if (end > expected) return false
      while (nextFilter < end) {
        const layout = passes[pass]
        if (!layout || chunk.readUInt8(nextFilter - decoded) > 4) return false
        nextFilter += layout.stride
        if (++row === layout.rows) {
          pass += 1
          row = 0
        }
      }
      decoded = end
    }
  } catch {
    return false
  }
  return (
    decoded === expected &&
    inflater.bytesWritten === chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  )
}
