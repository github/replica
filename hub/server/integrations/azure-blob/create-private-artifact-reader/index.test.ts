import { beforeEach, describe, expect, it, vi } from "vitest"

import { createPrivateBlobArtifactReader } from "."

const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    getContainerClient() {
      return { getBlockBlobClient: () => ({ download }) }
    }
  },
}))

describe("createPrivateBlobArtifactReader()", () => {
  beforeEach(() => download.mockReset())

  it.each([
    ["BlobNotFound", "not-found"],
    ["ContainerNotFound", "unavailable"],
  ])("returns %s as %s", async (errorCode, status) => {
    download.mockRejectedValueOnce({ statusCode: 404, details: { errorCode } })
    const read = createPrivateBlobArtifactReader({
      accountUrl: "https://example.blob.core.windows.net",
      container: "artifacts",
    })
    await expect(read("artifact", 12, AbortSignal.timeout(1000))).resolves.toEqual({ status })
  })
})
