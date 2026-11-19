import { crc32, deflateRawSync, deflateSync } from "node:zlib"
import { expect, it } from "vitest"

import { readHostedBuildPackage } from "."

interface FixtureEntry {
  path: string
  bytes: Buffer
  unixMode?: number
  declaredLength?: number
}

// Use ordinary deflated entries and data descriptors, as a streaming ZIP uploader does.
function zip(entries: FixtureEntry[]) {
  const files: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { path, bytes, unixMode = 0x81a4, declaredLength = bytes.length } of entries) {
    const name = Buffer.from(path)
    const compressed = deflateRawSync(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(name.length, 26)
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50)
    descriptor.writeUInt32LE(crc32(bytes), 4)
    descriptor.writeUInt32LE(compressed.length, 8)
    descriptor.writeUInt32LE(declaredLength, 12)
    files.push(local, name, compressed, descriptor)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(0x0314, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 8)
    entry.writeUInt16LE(8, 10)
    descriptor.copy(entry, 16, 4)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt16LE(unixMode, 40)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += local.length + name.length + compressed.length + descriptor.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(
    central.reduce((size, bytes) => size + bytes.length, 0),
    12,
  )
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, ...central, end])
}

function png(width: number, height: number) {
  function chunk(type: string, value: Buffer) {
    const bytes = Buffer.alloc(12 + value.length)
    bytes.writeUInt32BE(value.length)
    bytes.write(type, 4, "ascii")
    value.copy(bytes, 8)
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4)
    return bytes
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const rootFiles = [
  { path: "dist/index.html", bytes: Buffer.from("<main>Prototype</main>") },
  { path: "screenshots/desktop.png", bytes: png(1440, 900) },
  { path: "screenshots/narrow.png", bytes: png(390, 844) },
] as const

async function read(archive: Buffer) {
  const files = []
  for await (const file of readHostedBuildPackage(archive)) files.push(file)
  return files
}

it("retains light and dark screenshots for the declared template and root without changing bytes", async () => {
  const manifest = {
    path: "templates.json",
    bytes: Buffer.from(
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "welcome",
            name: "Welcome",
            description: "Welcome screen",
            category: "Product",
            path: "/welcome?filter[state]=open#/details",
          },
        ],
      }),
    ),
  }
  const extra = rootFiles.slice(1).flatMap(({ path, bytes }) => [
    { path: path.replace(".png", "-dark.png"), bytes },
    { path: path.replace("screenshots/", "screenshots/templates/welcome/"), bytes },
    {
      path: path
        .replace("screenshots/", "screenshots/templates/welcome/")
        .replace(".png", "-dark.png"),
      bytes,
    },
  ])
  const input = [...rootFiles, manifest, ...extra]
  const files = await read(zip(input))
  expect(files.map(({ path, bytes }) => ({ path, bytes }))).toEqual(input)
  expect(files.find(({ path }) => path === "templates.json")?.kind).toBe("manifest")
})

it("allows a light-only package but not a partial dark set", async () => {
  await expect(read(zip([...rootFiles]))).resolves.toHaveLength(3)
  await expect(
    read(zip([...rootFiles, { path: "screenshots/desktop-dark.png", bytes: rootFiles[1].bytes }])),
  ).rejects.toThrow("expected screenshots")
})

it.each([
  { path: "dist/../unexpected.txt" },
  { path: "dist/INDEX.HTML" },
  { path: "dist/linked-file", unixMode: 0xa1ff },
  { path: "dist/incorrect-size.txt", declaredLength: 1 },
])("rejects unsafe ZIP entry metadata: %j", async (entry) => {
  const archive = zip([...rootFiles, { bytes: Buffer.from("data"), ...entry }])
  await expect(read(archive)).rejects.toThrow()
})

it("does not accept an otherwise valid ZIP with an incomplete PNG", async () => {
  const archive = zip([
    ...rootFiles.slice(0, 2),
    { ...rootFiles[2], bytes: rootFiles[2].bytes.subarray(0, -12) },
  ])
  await expect(read(archive)).rejects.toThrow("invalid screenshot")
})

it("validates the actual retained Controls definition", async () => {
  const archive = zip([
    ...rootFiles,
    { path: "dist/controls.replica.json", bytes: Buffer.from('{"version":2}') },
  ])
  await expect(read(archive)).rejects.toThrow("invalid Controls")
})
