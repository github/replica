import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import { createSolidPng } from "."

describe("createSolidPng()", () => {
  it("writes a decodable RGB image with the requested viewport dimensions", () => {
    const bytes = createSolidPng(390, 844, [12, 34, 56])
    const buffer = Buffer.from(bytes)
    const imageData = []
    for (let offset = 8; offset < buffer.length;) {
      const length = buffer.readUInt32BE(offset)
      const type = buffer.toString("ascii", offset + 4, offset + 8)
      if (type === "IDAT") imageData.push(buffer.subarray(offset + 8, offset + 8 + length))
      offset += 12 + length
    }

    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(buffer.readUInt32BE(16)).toBe(390)
    expect(buffer.readUInt32BE(20)).toBe(844)
    expect(inflateSync(Buffer.concat(imageData))).toHaveLength((390 * 3 + 1) * 844)
  })
})
