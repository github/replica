import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { guardPreviewState } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const target = { account: "replicastatesample", container: "terraform", key: "sample/private-preview.tfstate" }
const lineage = "11111111-1111-4111-8111-111111111111"
const snapshot = (serial: number, stateLineage = lineage) => ({
  version: 4,
  terraform_version: "1.13.0",
  serial,
  lineage: stateLineage,
  outputs: {},
  resources: [],
})

async function fixture({
  saved,
  exists = saved !== undefined,
  uploadFails = false,
}: {
  saved?: unknown
  exists?: unknown
  uploadFails?: boolean
}) {
  const directory = resolve(`.preview-state-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  let blob = saved === undefined ? undefined : JSON.stringify(saved)
  const azure = vi.fn(async (...args: string[]) => {
    const operation = args.slice(0, 3).join(" ")
    const file = args[args.indexOf("--file") + 1]!
    if (operation === "storage blob exists") return JSON.stringify({ exists })
    if (operation === "storage blob download") {
      if (blob === undefined) throw new Error("BlobNotFound")
      await writeFile(file, blob)
      return ""
    }
    if (operation === "storage blob upload") {
      if (uploadFails) throw new Error("BlobAlreadyExists")
      blob = await readFile(file, "utf8")
      return ""
    }
    throw new Error(`Unexpected Azure command: ${args.join(" ")}`)
  })
  const resourcesExist = vi.fn(async () => false)
  const run = () => guardPreviewState({ azure, directory, target, resourcesExist })
  return { azure, directory, resourcesExist, run, uploads: () => azure.mock.calls.filter((call) => call[2] === "upload") }
}

describe("guardPreviewState", () => {
  it("accepts later snapshots of the saved state and rejects an older serial or a recreated state", async () => {
    const { run, uploads, directory } = await fixture({ saved: snapshot(5) })

    const guard = await run()

    expect(guard.lineage).toBe(lineage)
    expect(uploads()).toEqual([])
    expect(await readdir(directory)).toEqual([])
    expect(() => guard.verify(snapshot(5))).not.toThrow()
    expect(() => guard.verify(snapshot(6))).not.toThrow()
    expect(() => guard.verify(snapshot(5))).toThrow(/different state/)
    // What Terraform's backend reports after silently recreating a deleted state blob.
    expect(() => guard.verify(snapshot(0, randomUUID()))).toThrow(/different state/)
  })

  it("blocks without creating state when saved state is missing but resources exist", async () => {
    const { run, resourcesExist, uploads } = await fixture({})
    resourcesExist.mockResolvedValue(true)

    await expect(run()).rejects.toThrow(/missing, but private preview resources exist/)
    expect(uploads()).toEqual([])
  })

  it("creates empty state only if none exists, then expects that lineage", async () => {
    const { run, uploads } = await fixture({})

    const guard = await run()

    const [upload] = uploads()
    expect(upload).toEqual(expect.arrayContaining(["--if-none-match", "*"]))
    expect(upload).not.toContain("--overwrite")
    expect(guard.lineage).toMatch(/^[0-9a-f-]{36}$/)
    expect(() => guard.verify(snapshot(1, guard.lineage))).not.toThrow()
    expect(() => guard.verify(snapshot(1))).toThrow(/different state/)
  })

  it("blocks without retrying when another process creates the state first", async () => {
    const { run, uploads } = await fixture({ uploadFails: true })

    await expect(run()).rejects.toThrow(/could not be created exclusively/)
    expect(uploads()).toHaveLength(1)
  })

  it.each([
    ["Azure does not confirm whether state exists", { exists: "yes" }],
    ["the saved state is not a Terraform snapshot", { saved: { version: 3 } }],
  ])("blocks when %s", async (_, options) => {
    const { run, uploads, resourcesExist } = await fixture(options)

    await expect(run()).rejects.toThrow(/Terraform was not run/)
    expect(uploads()).toEqual([])
    expect(resourcesExist).not.toHaveBeenCalled()
  })
})
