import assert from "node:assert/strict"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { readTemplates } from "./index.ts"

describe("readTemplates()", () => {
  it("keeps repositories without templates compatible", async () => {
    const root = await temporaryDirectory()
    assert.equal(await readTemplates(root), null)
    await mkdir(path.join(root, ".github"))
    await writeFile(
      path.join(root, ".github/replica.json"),
      '{"version":1,"hub":{"origin":"https://example.com"}}',
    )
    assert.equal(await readTemplates(root), null)
  })

  it("reads normalized package metadata without requiring a Hub origin", async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, "templates.json"), '{"version":1,"templates":[]}')
    assert.deepEqual(await readTemplates(root, "templates.json"), { version: 1, templates: [] })
  })

  it("accepts exactly 16 KiB of configuration", async () => {
    const root = await temporaryDirectory()
    const metadata = '{"version":1,"templates":[]}'
    await writeFile(path.join(root, "templates.json"), metadata.padEnd(16 * 1024, " "))
    assert.deepEqual(await readTemplates(root, "templates.json"), { version: 1, templates: [] })
  })

  it("rejects malformed and oversized configuration with explicit errors", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, ".github"))
    await writeFile(path.join(root, ".github/replica.json"), "{not json")
    await assert.rejects(readTemplates(root), /correctly formatted JSON/)
    await writeFile(path.join(root, ".github/replica.json"), " ".repeat(16 * 1024 + 1))
    await assert.rejects(readTemplates(root), /at most 16384 bytes/)
  })

  it("rejects linked metadata and linked configuration directories", async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await writeFile(path.join(outside, "replica.json"), '{"version":1,"templates":[]}')
    await symlink(outside, path.join(root, ".github"))
    await assert.rejects(readTemplates(root), /without symbolic links/)

    const other = await temporaryDirectory()
    await mkdir(path.join(other, ".github"))
    await symlink(path.join(outside, "replica.json"), path.join(other, ".github/replica.json"))
    await assert.rejects(readTemplates(other), /without symbolic links/)
  })
})
