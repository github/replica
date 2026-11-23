import { randomUUID } from "node:crypto"
import { mkdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { createPrivateArtifactReader } from "."

async function createFixture() {
  const directory = resolve(`server/integrations/filesystem/.private-reader-test-${randomUUID()}`)
  await mkdir(directory)
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const key = "sample-artifact"
  const bytes = Buffer.from("sample bytes")
  await writeFile(join(directory, key), bytes)
  return { directory, key, bytes, read: createPrivateArtifactReader(directory) }
}

describe("createPrivateArtifactReader()", () => {
  it("returns exact recorded bytes for an opaque key", async () => {
    const { read, key, bytes } = await createFixture()

    await expect(read(key, bytes.length, new AbortController().signal)).resolves.toEqual({
      status: "ok",
      bytes,
    })
  })

  it("distinguishes a missing artifact from an unavailable read", async () => {
    const { read, bytes } = await createFixture()

    await expect(read("absent", bytes.length, new AbortController().signal)).resolves.toEqual({
      status: "not-found",
    })
  })

  it("rejects a filename that is not an opaque storage key", async () => {
    const { read, directory, bytes } = await createFixture()
    await writeFile(join(directory, "sample.css"), bytes)

    await expect(read("sample.css", bytes.length, new AbortController().signal)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("does not follow a link to another fixture file", async () => {
    const { read, directory, key, bytes } = await createFixture()
    await symlink(key, join(directory, "sample-link"), "file")

    await expect(read("sample-link", bytes.length, new AbortController().signal)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("does not return a directory as an artifact", async () => {
    const { read, directory } = await createFixture()
    const folder = join(directory, "sample-folder")
    await mkdir(folder)
    const { size } = await stat(folder)

    await expect(read("sample-folder", size, new AbortController().signal)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("does not return partial bytes when the file size differs from the recorded length", async () => {
    const { read, key, bytes } = await createFixture()

    await expect(read(key, bytes.length - 1, new AbortController().signal)).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("does not return bytes after cancellation", async () => {
    const { read, key, bytes } = await createFixture()

    await expect(read(key, bytes.length, AbortSignal.abort())).resolves.toEqual({
      status: "unavailable",
    })
  })
})
