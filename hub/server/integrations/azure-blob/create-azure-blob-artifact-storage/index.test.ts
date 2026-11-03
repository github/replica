import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  credential: vi.fn(),
  service: vi.fn(),
  container: vi.fn(),
  getProperties: vi.fn(),
  download: vi.fn(),
  uploadData: vi.fn(),
  delete: vi.fn(),
}))
vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {
    constructor(...args: unknown[]) {
      mocks.credential(...args)
    }
  },
}))
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    constructor(...args: unknown[]) {
      mocks.service(...args)
    }
    getContainerClient(name: string) {
      mocks.container(name)
      return { getProperties: mocks.getProperties, getBlockBlobClient: () => mocks }
    }
  },
}))

import { createAzureBlobArtifactStorage } from "."

describe("createAzureBlobArtifactStorage()", () => {
  it("checks the configured container with the supplied abort signal without touching blobs", async () => {
    const storage = createAzureBlobArtifactStorage(
      { accountUrl: "https://example.blob.core.windows.net", container: "artifacts" },
      3,
    )
    const signal = new AbortController().signal
    let succeed!: () => void
    mocks.getProperties.mockReturnValue(new Promise<void>((resolve) => (succeed = resolve)))
    let settled = false
    const ready = storage.isReady(signal).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    succeed()

    expect(await ready).toBe(true)
    expect(mocks.container).toHaveBeenCalledExactlyOnceWith("artifacts")
    expect(mocks.getProperties).toHaveBeenCalledExactlyOnceWith({ abortSignal: signal })
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.uploadData).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it("reports unavailable storage when the authenticated container check fails", async () => {
    const storage = createAzureBlobArtifactStorage(
      { accountUrl: "https://example.blob.core.windows.net", container: "artifacts" },
      3,
    )
    mocks.getProperties.mockRejectedValue(new Error("Private provider diagnostics"))

    expect(await storage.isReady(new AbortController().signal)).toBe(false)
  })

  it("uses only managed identity and conditional writes with bounded binary reads", async () => {
    const clientId = "ee5eeebb-74e0-4b79-8030-c325e50fec43"
    const storage = createAzureBlobArtifactStorage(
      {
        accountUrl: "https://example.blob.core.windows.net",
        container: "artifacts",
        managedIdentityClientId: clientId,
      },
      3,
    )
    const bytes = Uint8Array.from([0, 255, 1])
    mocks.download.mockResolvedValue({
      contentLength: 3,
      readableStreamBody: Readable.from([bytes]),
    })

    expect(await storage.write("key", bytes)).toEqual({ status: "ok" })
    expect(mocks.uploadData).toHaveBeenCalledWith(
      bytes,
      expect.objectContaining({ conditions: { ifNoneMatch: "*" } }),
    )
    expect(await storage.read("key")).toEqual({ status: "ok", bytes: Buffer.from(bytes) })
    expect(await storage.delete("key")).toEqual({ status: "ok" })
    expect(mocks.credential).toHaveBeenCalledExactlyOnceWith({ clientId })
  })

  it("returns explicit missing and immutable-write conflict results", async () => {
    const storage = createAzureBlobArtifactStorage(
      { accountUrl: "https://example.blob.core.windows.net", container: "artifacts" },
      3,
    )
    mocks.download.mockRejectedValue({ details: { errorCode: "BlobNotFound" } })
    mocks.delete.mockRejectedValue({ details: { errorCode: "BlobNotFound" } })
    mocks.uploadData.mockRejectedValue({ details: { errorCode: "ConditionNotMet" } })

    expect(await storage.read("key")).toEqual({ status: "not-found" })
    expect(await storage.delete("key")).toEqual({ status: "not-found" })
    expect(await storage.write("key", Uint8Array.of(1))).toEqual({ status: "already-exists" })
    expect(mocks.credential).toHaveBeenCalledExactlyOnceWith()
  })

  it("maps provider failures without leaking SDK errors or treating a missing container as missing bytes", async () => {
    const storage = createAzureBlobArtifactStorage(
      { accountUrl: "https://example.blob.core.windows.net", container: "artifacts" },
      3,
    )
    mocks.download.mockRejectedValue({
      details: { errorCode: "ContainerNotFound" },
      message: "secret",
    })
    mocks.delete.mockRejectedValue(new Error("secret"))
    mocks.uploadData.mockRejectedValue(new Error("secret"))

    expect(await storage.read("key")).toEqual({ status: "unavailable" })
    expect(await storage.delete("key")).toEqual({ status: "unavailable" })
    expect(await storage.write("key", Uint8Array.of(1))).toEqual({ status: "unavailable" })
  })

  it("stops oversized reads and accepts empty objects", async () => {
    const storage = createAzureBlobArtifactStorage(
      { accountUrl: "https://example.blob.core.windows.net", container: "artifacts" },
      3,
    )
    const stream = Readable.from([Uint8Array.of(1, 2, 3, 4)])
    mocks.download.mockResolvedValueOnce({ readableStreamBody: stream })
    expect(await storage.read("key")).toEqual({ status: "too-large" })
    expect(stream.destroyed).toBe(true)
    mocks.download.mockResolvedValueOnce({
      contentLength: 0,
      readableStreamBody: Readable.from([]),
    })
    expect(await storage.read("empty")).toEqual({ status: "ok", bytes: Buffer.alloc(0) })
  })
})
