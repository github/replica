import { describe, expect, it } from "vitest"

import { createZipArchive } from "../../test/create-zip-archive/index.ts"
import { ZipArchiveError } from "./errors.ts"
import { readZipArchive } from "./index.ts"

const limits = {
  maximumEntries: 10,
  maximumEntryBytes: () => 1_000,
  maximumTotalBytes: 2_000,
}

describe("readZipArchive", () => {
  it("reads stored and deflated regular files and skips directories", () => {
    const archive = createZipArchive([
      { name: "dist/", mode: 0o040755 },
      { name: "dist/index.html", bytes: "<h1>Hi</h1>" },
      { name: "templates.json", bytes: "{}", method: 0 },
    ])

    expect(
      readZipArchive(archive, limits).map(({ name, bytes }) => [name, bytes.toString()]),
    ).toEqual([
      ["dist/index.html", "<h1>Hi</h1>"],
      ["templates.json", "{}"],
    ])
  })

  it.each([
    ["symbolic links", [{ name: "dist/link", bytes: "/etc/passwd", mode: 0o120777 }]],
    ["encrypted entries", [{ name: "dist/a", bytes: "a", flags: 0x801 }]],
    [
      "duplicate names",
      [
        { name: "dist/a", bytes: "a" },
        { name: "dist/a", bytes: "b" },
      ],
    ],
    ["oversized entries", [{ name: "dist/a", bytes: "x".repeat(1_001) }]],
    [
      "oversized totals",
      [
        { name: "dist/a", bytes: "x".repeat(1_000) },
        { name: "dist/b", bytes: "x".repeat(1_000) },
        { name: "dist/c", bytes: "x" },
      ],
    ],
    ["too many entries", Array.from({ length: 11 }, (_, index) => ({ name: `dist/${index}` }))],
  ])("rejects %s", (_label, entries) => {
    expect(() => readZipArchive(createZipArchive(entries), limits)).toThrow(ZipArchiveError)
  })

  it("rejects ZIP64 markers and corrupted data", () => {
    const zip64 = createZipArchive([{ name: "dist/a", bytes: "a" }])
    zip64.writeUInt32LE(0xffffffff, zip64.length - 6)
    expect(() => readZipArchive(zip64, limits)).toThrow("ZIP64")

    const corrupted = createZipArchive([{ name: "dist/a", bytes: "abc", method: 0 }])
    corrupted[30 + "dist/a".length] = "z".charCodeAt(0)
    expect(() => readZipArchive(corrupted, limits)).toThrow("checksum")

    expect(() => readZipArchive(Buffer.from("not a zip archive at all"), limits)).toThrow(
      ZipArchiveError,
    )
  })

  it("rejects entries that inflate beyond their recorded size", () => {
    const archive = createZipArchive([{ name: "dist/a", bytes: "x".repeat(500) }])
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    archive.writeUInt32LE(10, central + 24)
    expect(() => readZipArchive(archive, limits)).toThrow(ZipArchiveError)
  })
})
