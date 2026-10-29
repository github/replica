import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { readTemplates } from "./index.ts"

describe("readTemplates()", () => {
  it("keeps repositories without templates compatible", async () => {
    const root = await temporaryDirectory()
    expect(await readTemplates(root)).toBeNull()
    await mkdir(path.join(root, ".github"))
    await writeFile(
      path.join(root, ".github/replica.json"),
      '{"version":1,"hub":{"origin":"https://example.com"}}',
    )
    expect(await readTemplates(root)).toBeNull()
  })

  it("reads normalized package metadata without requiring a Hub origin", async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, "templates.json"), '{"version":1,"templates":[]}')
    expect(await readTemplates(root, "templates.json")).toStrictEqual({ version: 1, templates: [] })
  })

  it("accepts exactly 16 KiB of configuration", async () => {
    const root = await temporaryDirectory()
    const metadata = '{"version":1,"templates":[]}'
    await writeFile(path.join(root, "templates.json"), metadata.padEnd(16 * 1024, " "))
    expect(await readTemplates(root, "templates.json")).toStrictEqual({ version: 1, templates: [] })
  })

  it("rejects malformed and oversized configuration with explicit errors", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, ".github"))
    await writeFile(path.join(root, ".github/replica.json"), "{not json")
    await expect(readTemplates(root)).rejects.toThrow(/correctly formatted JSON/)
    await writeFile(path.join(root, ".github/replica.json"), " ".repeat(16 * 1024 + 1))
    await expect(readTemplates(root)).rejects.toThrow(/at most 16384 bytes/)
  })

  it("rejects linked metadata and linked configuration directories", async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await writeFile(path.join(outside, "replica.json"), '{"version":1,"templates":[]}')
    await symlink(outside, path.join(root, ".github"))
    await expect(readTemplates(root)).rejects.toThrow(/without symbolic links/)

    const other = await temporaryDirectory()
    await mkdir(path.join(other, ".github"))
    await symlink(path.join(outside, "replica.json"), path.join(other, ".github/replica.json"))
    await expect(readTemplates(other)).rejects.toThrow(/without symbolic links/)
  })
})
