import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { createScreenshotStore } from "../src/screenshots.mjs"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe("screenshot store", () => {
  it("refuses damaged bytes on read and replaces them when the image is stored again", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "replica-shots-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const store = createScreenshotStore(directory)

    const digest = await store.put(PNG)
    assert.deepEqual(await store.read(digest), PNG)
    const [file] = await readdir(directory)
    await writeFile(path.join(directory, file), Buffer.concat([PNG, Buffer.from([4])]))

    await assert.rejects(store.read(digest), { code: "storage_corrupt" })
    assert.equal(await store.put(PNG), digest)
    assert.deepEqual(await store.read(digest), PNG)
    await store.remove(digest)
    assert.equal(await store.read(digest), null)
  })
})
