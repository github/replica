import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished, vi } from "vitest"

const mocks = vi.hoisted(() => ({ unlink: vi.fn() }))
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  unlink: mocks.unlink,
}))

import { createFilesystemArtifactStorage } from "."

describe("createFilesystemArtifactStorage()", () => {
  it("preserves committed writes and publication failures when staging cleanup fails", async () => {
    const directory = resolve(`server/integrations/filesystem/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const reportCleanupFailure = vi.fn()
    const storage = await createFilesystemArtifactStorage(directory, 3, reportCleanupFailure)
    mocks.unlink.mockRejectedValue(new Error("Private filesystem diagnostics"))

    expect(await storage.write("key", Uint8Array.of(1, 2))).toEqual({ status: "ok" })
    expect(await readFile(`${directory}/key`)).toEqual(Buffer.from([1, 2]))
    expect(reportCleanupFailure).toHaveBeenCalledTimes(1)

    expect(await storage.write("key", Uint8Array.of(3))).toEqual({ status: "already-exists" })
    expect(await readFile(`${directory}/key`)).toEqual(Buffer.from([1, 2]))
    expect(reportCleanupFailure).toHaveBeenCalledTimes(2)
    expect(reportCleanupFailure.mock.calls).toEqual([[], []])
  })
})
