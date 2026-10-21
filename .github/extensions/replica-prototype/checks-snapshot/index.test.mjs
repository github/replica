import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"

import { createChecksSnapshot } from "./index.mjs"

function fixture(content = "first\nsecond\n", extra = []) {
  const files = new Map([["page.tsx", Buffer.from(content)], ...extra])
  const input = { files, pageFiles: { page: [...files.keys()] } }
  return createChecksSnapshot(input, [{ id: "page" }])
}

describe("createChecksSnapshot()", () => {
  it("makes guidance readable without assessing it and denies unrelated snapshot reads", () => {
    const input = {
      files: new Map([
        ["src/page.tsx", Buffer.from("source")],
        ["src/other.tsx", Buffer.from("unrelated source")],
        ["docs/design.md", Buffer.from("Context guidance")],
        ["review.md", Buffer.from("Review instructions")],
      ]),
      pageFiles: {},
    }
    const reader = createChecksSnapshot(input, [], {
      files: ["src/page.tsx", "missing.tsx"],
      contextFiles: ["docs/design.md"],
      instructionsFile: "review.md",
      pages: [],
    })
    assert.match(JSON.parse(reader.read({ file: "docs/design.md" })).content, /Context guidance/)
    assert.match(JSON.parse(reader.read({ file: "review.md" })).content, /Review instructions/)
    assert.equal(reader.read({ file: "src/other.tsx" }).resultType, "failure")
    const required = reader.coverage().files.filter((file) => file.required)
    assert.deepEqual(required.map((file) => file.file).sort(), ["missing.tsx", "src/page.tsx"])
    assert.equal(required.find((file) => file.file === "missing.tsx").reason, "missing")
  })
  it("reports missing required files without silently treating them as an empty scope", () => {
    const reader = createChecksSnapshot(
      { files: new Map(), pageFiles: { page: ["missing.tsx"] } },
      [{ id: "page" }],
    )
    assert.equal(reader.coverage().files[0].required, true)
    assert.equal(reader.coverage().files[0].reason, "missing")
    assert.equal(reader.coverage().files[0].status, "blocked")
    assert.equal(reader.read({ file: "missing.tsx" }).resultType, "failure")
  })

  it("delivers the actual Canvas app and Hub panel sources completely and without truncation", async () => {
    for (const file of ["application/prototype-canvas", "features/prototype-canvas-hub-panel"]) {
      const source = await readFile(
        new URL(`../../../../hub/app/javascript/${file}/index.tsx`, import.meta.url),
        "utf8",
      )
      const reader = fixture(source)
      let offset = 0
      let restored = ""
      do {
        const response = reader.read({ file: "page.tsx", offset })
        assert.ok(Buffer.byteLength(response) <= 8192)
        const chunk = JSON.parse(response)
        restored += chunk.content.replace(/^\d+: /gm, "")
        offset = chunk.nextOffset
      } while (offset !== null)
      assert.equal(restored, source)
      assert.equal(reader.coverage().files[0].status, "read")
    }
  })

  it("bounds serialized metadata even for long paths and EOF continuations", () => {
    const reader = fixture(
      "source",
      Array.from({ length: 60 }, (_, index) => [
        `${"folder/".repeat(100)}${index}.tsx`,
        Buffer.from("source"),
      ]),
    )
    let offset = 0
    let count = 0
    do {
      const response = reader.list({ offset, limit: 50 })
      assert.ok(Buffer.byteLength(response) <= 8192)
      const page = JSON.parse(response)
      count += page.files.length
      offset = page.nextOffset
    } while (offset !== null)
    assert.equal(count, 61)
  })
  it("returns numbered source with exact byte ranges and explicit continuation", () => {
    const reader = fixture()
    const chunk = JSON.parse(reader.read({ file: "page.tsx" }))
    assert.equal(chunk.content, "1: first\n2: second\n")
    assert.equal(chunk.offset, 0)
    assert.equal(chunk.endOffset, 13)
    assert.equal(chunk.startLine, 1)
    assert.equal(chunk.endLine, 2)
    assert.equal(chunk.nextOffset, null)
    assert.equal(reader.coverage().files[0].status, "read")
  })

  for (const size of [34652, 50989, 150000]) {
    it(`fully delivers a ${size}-byte file in bounded chunks without the old whole-file limit`, () => {
      const source = "const value = true;\n".repeat(Math.ceil(size / 20)).slice(0, size)
      const reader = fixture(source)
      let offset = 0
      let restored = ""
      do {
        const response = reader.read({ file: "page.tsx", offset })
        assert.ok(Buffer.byteLength(response) <= 8192)
        const chunk = JSON.parse(response)
        assert.equal(chunk.offset, offset)
        assert.ok(chunk.endOffset > offset)
        assert.ok(chunk.endLine - chunk.startLine < 80)
        restored += chunk.content.replace(/^\d+: /gm, "")
        offset = chunk.nextOffset
      } while (offset !== null)
      assert.equal(restored, source)
      assert.equal(reader.coverage().files[0].readBytes, size)
      assert.equal(reader.coverage().files[0].status, "read")
    })
  }

  it("continues very long Unicode lines without splitting a UTF-8 character", () => {
    const source = `"\u{1f680}\u00e9".repeat(1)\n` + "\u{1f680}".repeat(4000)
    const reader = fixture(source)
    let offset = 0
    let restored = ""
    let continued = false
    do {
      const response = reader.read({ file: "page.tsx", offset })
      assert.ok(Buffer.byteLength(response) <= 8192)
      const chunk = JSON.parse(response)
      continued ||= chunk.startsMidLine
      restored += chunk.content.replace(/^\d+: /gm, "")
      offset = chunk.nextOffset
    } while (offset !== null)
    assert.equal(restored, source)
    assert.equal(continued, true)
    assert.equal(reader.read({ file: "page.tsx", offset: 2 }).resultType, "failure")
  })

  it("keeps escaped/control-character output within the serialized byte budget", () => {
    const reader = fixture("\u0001".repeat(12000))
    const response = reader.read({ file: "page.tsx" })
    assert.ok(Buffer.byteLength(response) <= 8192)
    assert.ok(JSON.parse(response).nextOffset > 0)
  })

  it("merges repeated, overlapping and out-of-order reads without covering holes", () => {
    const reader = fixture("x".repeat(20000))
    reader.read({ file: "page.tsx", offset: 8000 })
    reader.read({ file: "page.tsx", offset: 8000 })
    reader.read({ file: "page.tsx", offset: 9000 })
    assert.equal(reader.coverage().files[0].readBytes, 5096)
    assert.equal(reader.coverage().files[0].status, "partial")
    assert.equal(
      JSON.parse(reader.list({ requiredOnly: true, incompleteOnly: true })).files[0].nextOffset,
      0,
    )
    reader.read({ file: "page.tsx", offset: 0 })
    reader.read({ file: "page.tsx", offset: 4096 })
    reader.read({ file: "page.tsx", offset: 12000 })
    reader.read({ file: "page.tsx", offset: 16000 })
    assert.equal(reader.coverage().files[0].readBytes, 20000)
    assert.equal(JSON.parse(reader.list({ incompleteOnly: true })).files.length, 0)
  })

  it("reports unread, partial and blocked inputs with reasons without requiring binary assets", () => {
    const reader = fixture("x".repeat(10000), [
      ["image.png", Buffer.from([0, 1, 2])],
      ["broken.tsx", Buffer.from([0xff])],
      ["unread.ts", Buffer.from("source")],
    ])
    reader.read({ file: "page.tsx" })
    const files = new Map(reader.coverage().files.map((file) => [file.file, file]))
    assert.equal(files.get("page.tsx").status, "partial")
    assert.equal(files.get("unread.ts").reason, "not_read")
    assert.equal(files.get("image.png").status, "blocked")
    assert.equal(files.get("image.png").required, false)
    assert.equal(files.get("broken.tsx").reason, "invalid_utf8")
    assert.equal(files.get("broken.tsx").required, true)
    assert.equal(reader.read({ file: "broken.tsx" }).resultType, "failure")
    assert.equal(reader.read({ file: "/etc/passwd" }).resultType, "failure")
    assert.equal(reader.read({ file: "page.tsx", offset: -1 }).resultType, "failure")
    assert.equal(reader.read({ file: "page.tsx", offset: 10001 }).resultType, "failure")
    assert.equal(reader.read({ file: "page.tsx", offset: 1.5 }).resultType, "failure")
  })

  it("requires an explicit successful read even for empty files and does not count invalid requests", () => {
    const reader = fixture("")
    assert.equal(reader.coverage().files[0].status, "unread")
    reader.read({ file: "page.tsx", offset: -1 })
    assert.equal(reader.coverage().files[0].status, "unread")
    assert.equal(JSON.parse(reader.read({ file: "page.tsx" })).content, "")
    assert.equal(reader.coverage().files[0].status, "read")
  })

  it("paginates metadata in a bounded stable inventory even when read status changes", () => {
    const reader = fixture(
      "first",
      Array.from({ length: 75 }, (_, index) => [
        `${index.toString().padStart(2, "0")}.ts`,
        Buffer.from("source"),
      ]),
    )
    let offset = 0
    const seen = []
    do {
      const response = reader.list({ offset, limit: 7, requiredOnly: true, incompleteOnly: true })
      assert.ok(Buffer.byteLength(response) <= 8192)
      const page = JSON.parse(response)
      for (const file of page.files) {
        seen.push(file.file)
        reader.read({ file: file.file })
      }
      offset = page.nextOffset
    } while (offset !== null)
    assert.equal(new Set(seen).size, 76)
    assert.equal(reader.list({ limit: 51 }).resultType, "failure")
  })

  it("validates persisted receipts against scoped names, sizes, requirements and byte counts", () => {
    const reader = fixture()
    reader.read({ file: "page.tsx" })
    const coverage = reader.coverage()
    assert.deepEqual(reader.validateCoverage(coverage), coverage)
    for (const patch of [
      { totalBytes: 999 },
      { readBytes: -1 },
      { required: false },
      { status: "partial" },
      { pageIds: ["elsewhere"] },
    ]) {
      assert.throws(
        () =>
          reader.validateCoverage({
            ...coverage,
            files: [{ ...coverage.files[0], ...patch }],
          }),
        /coverage/,
      )
    }
    assert.throws(() => reader.validateCoverage({ ...coverage, files: [] }), /coverage/)
  })
})
