import { Readable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import type { BlockBlobUploadOptions } from "@azure/storage-blob"
import { describe, expect, it, vi } from "vitest"

import { deferred } from "../../../../test/ws/deferred"
import { privatePreviewAddress } from "../../../utils/private-preview-address"
import { artifactMaxBytes, createArtifactStorage } from "../../artifacts/create-artifact-storage"
import type {
  ArtifactReadResult,
  ArtifactStorage,
} from "../../artifacts/create-artifact-storage/types"
import { digestDistFiles } from "../../build-artifacts/digest-dist-files"
import type { BuildPackageFile } from "../../build-artifacts/types"
import type { GitHubBuildImportDependencies } from "../../github-builds/types"
import { privatePreviewManifestPath } from "../types"
import { publishGitHubBuildPreview } from "."

const address = privatePreviewAddress("901", "1201")!
const buildId = "45fe6ae5-0d33-45a3-9eb3-4baea8ee9799"
const rawFailure = new Error("synthetic backend details")
const overwriteDenied = Object.assign(new Error("Overwrite requires write permission"), {
  statusCode: 403,
  details: { errorCode: "UnauthorizedBlobOverwrite" },
})
const blobNotFound = Object.assign(new Error("Blob is missing"), {
  statusCode: 404,
  details: { errorCode: "BlobNotFound" },
})

const azure = vi.hoisted(() => ({
  uploadData:
    vi.fn<(key: string, bytes: Uint8Array, options: BlockBlobUploadOptions) => Promise<void>>(),
  download: vi.fn<(key: string) => Promise<unknown>>(),
}))
vi.mock("@azure/identity", () => ({ ManagedIdentityCredential: class {} }))
vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: class {
    getContainerClient() {
      return {
        getBlockBlobClient: (key: string) => ({
          uploadData: (bytes: Uint8Array, options: BlockBlobUploadOptions) =>
            azure.uploadData(key, bytes, options),
          download: () => azure.download(key),
        }),
      }
    }
  },
}))

function createAzureDestination() {
  return createArtifactStorage({
    provider: "azure-blob",
    accountUrl: "https://example.blob.core.windows.net",
    container: "private-preview-artifacts",
  })
}

function fixture(destinationStorage?: Pick<ArtifactStorage, "read" | "write">) {
  const files: BuildPackageFile[] = [
    { path: "dist/index.html", kind: "dist", bytes: Buffer.from("<h1>Home</h1>") },
    ...Array.from({ length: 5 }, (_, index): BuildPackageFile => ({
      path: `dist/asset-${index}.js`,
      kind: "dist",
      bytes: Buffer.from(`asset ${index}`),
    })),
    {
      path: privatePreviewManifestPath,
      kind: "dist",
      bytes: Buffer.from(JSON.stringify({ basePath: address.mount })),
    },
    { path: "templates.json", kind: "manifest", bytes: Buffer.from("[]") },
  ]
  const artifacts = files.map(({ path, kind, bytes }, index) => ({
    path,
    kind,
    storageKey: `artifact-${index}`,
    byteLength: bytes.byteLength,
  }))
  const target = {
    id: buildId,
    state: "successful",
    privatePreviewState: "pending" as "pending" | "ready" | null,
    distDigest: digestDistFiles(files),
    artifacts: [{ id: "index" }],
    prototype: {
      replica: false,
      branchName: "proto/demo",
      startPage: "/",
      repository: { id: "repo", removedAt: null, localPath: null, defaultBranch: "main" },
    },
  }
  const findMany = vi.fn().mockResolvedValue([target])
  const findUnique = vi.fn().mockResolvedValue({ distDigest: digestDistFiles(files), artifacts })
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  function sourceRead(storageKey: string): Promise<ArtifactReadResult> {
    const index = artifacts.findIndex((artifact) => artifact.storageKey === storageKey)
    const file = files[index]
    return Promise.resolve(file ? { status: "ok", bytes: file.bytes } : { status: "not-found" })
  }
  const storage = {
    isReady: vi.fn<ArtifactStorage["isReady"]>(),
    read: vi.fn(sourceRead),
    write: vi.fn<ArtifactStorage["write"]>(),
    delete: vi.fn<ArtifactStorage["delete"]>(),
  }
  const destination = {
    read: vi.fn<ArtifactStorage["read"]>(),
    write: vi.fn<ArtifactStorage["write"]>().mockResolvedValue({ status: "ok" }),
  }
  const logger = { info: vi.fn(), warn: vi.fn() }
  const build = { findMany, findUnique, updateMany }
  const database = {
    build,
    $transaction: vi.fn((work: (transaction: { build: typeof build }) => unknown) =>
      work({ build }),
    ),
  }
  const dependencies: GitHubBuildImportDependencies = {
    database: database as unknown as GitHubBuildImportDependencies["database"],
    storage,
    logger,
    privatePreviewWriter: {
      repositoryId: address.repositoryId,
      storage: destinationStorage ?? destination,
    },
  }
  function trackPublicationState() {
    updateMany.mockImplementation(
      ({ data }: { data: { privatePreviewState: "pending" | "ready" } }) => {
        target.privatePreviewState = data.privatePreviewState
        return Promise.resolve({ count: 1 })
      },
    )
  }
  function expectFailure(stage: string, reason: string) {
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { buildId, runId: address.runId, stage, reason },
      expect.any(String),
    )
    expect(logger.warn.mock.calls[0]?.[1]).not.toContain(rawFailure.message)
    expect(updateMany).not.toHaveBeenCalled()
  }

  return {
    findMany,
    findUnique,
    target,
    trackPublicationState,
    updateMany,
    storage,
    sourceRead,
    destination,
    manifestKey: artifacts.at(-1)!.storageKey,
    mountMarkerKey: artifacts.find(({ path }) => path === privatePreviewManifestPath)!.storageKey,
    publish: () => publishGitHubBuildPreview(dependencies, buildId, address),
    prepare(digest = target.distDigest) {
      return publishGitHubBuildPreview(
        {
          ...dependencies,
          privatePreviewWriter: { repositoryId: address.repositoryId, storage: destination },
        },
        buildId,
        address,
        digest,
      )
    },
    expectFailure,
  }
}

describe("publishGitHubBuildPreview()", () => {
  it("does not prepare or copy a historical Build with an invalid retained mount", async () => {
    const preview = fixture()
    preview.target.privatePreviewState = null
    preview.storage.read.mockImplementation(async (key) =>
      key === preview.mountMarkerKey
        ? { status: "ok", bytes: Buffer.from("{}") }
        : preview.sourceRead(key),
    )

    await expect(preview.prepare()).rejects.toThrow("source-mismatch")

    preview.expectFailure("verify-source", "source-mismatch")
    expect(preview.destination.write).not.toHaveBeenCalled()
  })

  it("prepares the exact historical Build before copying and marks it ready afterward", async () => {
    const preview = fixture()
    preview.target.privatePreviewState = null
    preview.trackPublicationState()
    preview.destination.write.mockImplementation(() => {
      expect(preview.target.privatePreviewState).toBe("pending")
      return Promise.resolve({ status: "ok" })
    })

    await preview.prepare(`sha256:${"0".repeat(64)}`)
    expect(preview.updateMany).not.toHaveBeenCalled()
    expect(preview.destination.write).not.toHaveBeenCalled()

    await preview.prepare()
    expect(preview.destination.write).toHaveBeenCalledTimes(6)
    expect(preview.target.privatePreviewState).toBe("ready")
  })

  it("keeps a prepared Build pending after a failed copy until an exact rerun completes it", async () => {
    const preview = fixture()
    preview.target.privatePreviewState = null
    preview.trackPublicationState()
    preview.destination.write.mockResolvedValueOnce({ status: "unavailable" })

    await expect(preview.prepare()).rejects.toThrow("destination-unavailable")
    expect(preview.target.privatePreviewState).toBe("pending")

    await preview.prepare()
    expect(preview.target.privatePreviewState).toBe("ready")
  })

  it("does not prepare a Build outside an automatic prototype branch", async () => {
    const preview = fixture()
    preview.target.privatePreviewState = null
    preview.target.prototype.branchName = "feature/demo"

    await preview.prepare()

    expect(preview.storage.read).not.toHaveBeenCalled()
    expect(preview.updateMany).not.toHaveBeenCalled()
    expect(preview.destination.write).not.toHaveBeenCalled()
  })

  it.each(["findMany", "findUnique"] as const)(
    "logs a safe read-target failure if the initial %s rejects",
    async (read) => {
      const preview = fixture()
      preview[read].mockRejectedValueOnce(rawFailure)

      await expect(preview.publish()).rejects.toThrow()

      preview.expectFailure("read-target", "database-error")
      expect(preview.storage.read).not.toHaveBeenCalled()
      expect(preview.destination.write).not.toHaveBeenCalled()
    },
  )

  it("does not copy any files if the retained package fails its digest check", async () => {
    const preview = fixture()
    preview.storage.read.mockImplementation(async (key) =>
      key === preview.manifestKey
        ? { status: "ok", bytes: Buffer.from("{}") }
        : preview.sourceRead(key),
    )

    await expect(preview.publish()).rejects.toThrow()

    preview.expectFailure("verify-source", "source-mismatch")
    expect(preview.destination.write).not.toHaveBeenCalled()
  })

  it("distinguishes a missing source from an unreadable source", async () => {
    const preview = fixture()
    preview.storage.read.mockResolvedValueOnce({ status: "not-found" })

    await expect(preview.publish()).rejects.toThrow()

    preview.expectFailure("verify-source", "source-missing")
    expect(preview.destination.write).not.toHaveBeenCalled()
  })

  it("resumes a partial Azure publication after verifying only the blobs denied as overwrites", async () => {
    const preview = fixture(await createAzureDestination())
    const blobs = new Map<string, Uint8Array>()
    const operations: string[] = []
    const servedKeys = [
      "artifact-0",
      "artifact-1",
      "artifact-2",
      "artifact-3",
      "artifact-4",
      "artifact-5",
    ]
    let interrupted = true
    azure.uploadData.mockImplementation((key, bytes) => {
      operations.push(`write ${key}`)
      if (blobs.has(key)) return Promise.reject(overwriteDenied)
      if (interrupted && key === "artifact-1") {
        return Promise.reject(
          Object.assign(new Error("Write denied"), {
            statusCode: 403,
            details: { errorCode: "AuthorizationPermissionMismatch" },
          }),
        )
      }
      blobs.set(key, bytes)
      return Promise.resolve()
    })
    azure.download.mockImplementation((key) => {
      operations.push(`read ${key}`)
      const bytes = blobs.get(key)
      if (!bytes) return Promise.reject(blobNotFound)
      return Promise.resolve({
        contentLength: bytes.byteLength,
        readableStreamBody: Readable.from([bytes]),
      })
    })

    await expect(preview.publish()).rejects.toThrow()
    preview.expectFailure("copy-files", "destination-unavailable")
    expect(azure.download).not.toHaveBeenCalled()
    const existingKeys = [...blobs.keys()]
    expect(existingKeys).not.toHaveLength(0)
    expect(existingKeys).not.toContain("artifact-1")

    interrupted = false
    operations.length = 0
    const objectsAtMarkReady = new Map<string, Buffer>()
    preview.updateMany.mockImplementationOnce(() => {
      for (const [key, bytes] of blobs) objectsAtMarkReady.set(key, Buffer.from(bytes))
      return Promise.resolve({ count: 1 })
    })
    await preview.publish()

    expect([...objectsAtMarkReady.keys()].sort()).toEqual(servedKeys)
    for (const key of servedKeys) {
      expect(await preview.sourceRead(key)).toEqual({
        status: "ok",
        bytes: objectsAtMarkReady.get(key),
      })
    }
    expect(azure.download.mock.calls.map(([key]) => key).sort()).toEqual(existingKeys.sort())
    for (const key of existingKeys) {
      expect(operations.filter((operation) => operation.endsWith(` ${key}`))).toEqual([
        `write ${key}`,
        `read ${key}`,
      ])
    }
    for (const [, , options] of azure.uploadData.mock.calls) {
      expect(options.conditions).toEqual({ ifNoneMatch: "*" })
    }
    expect(preview.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: buildId,
        githubWorkflowRunId: BigInt(address.runId),
        state: "successful",
        privatePreviewState: "pending",
      },
      data: { privatePreviewState: "ready" },
    })
  })

  it.each([
    ["different bytes of the same length", "destination-conflict"],
    ["an oversized blob", "destination-unavailable"],
    ["a missing blob", "destination-unavailable"],
    ["an unreadable blob", "destination-unavailable"],
  ] as const)("leaves the Build pending when readback finds %s", async (readback, reason) => {
    const preview = fixture(await createAzureDestination())
    azure.uploadData.mockResolvedValue(undefined).mockRejectedValueOnce(overwriteDenied)
    if (readback === "a missing blob") {
      azure.download.mockRejectedValueOnce(blobNotFound)
    } else if (readback === "an unreadable blob") {
      azure.download.mockRejectedValueOnce(rawFailure)
    } else {
      const oversized = readback === "an oversized blob"
      const bytes = Buffer.from(oversized ? "<h1>Home</h1>" : "<h1>Else</h1>")
      azure.download.mockResolvedValueOnce({
        contentLength: oversized ? artifactMaxBytes + 1 : bytes.length,
        readableStreamBody: Readable.from([bytes]),
      })
    }

    await expect(preview.publish()).rejects.toThrow()

    preview.expectFailure("copy-files", reason)
    expect(azure.download).toHaveBeenCalledExactlyOnceWith("artifact-0")
  })

  it("does not mark a different pending target ready after copying files", async () => {
    const preview = fixture()
    preview.destination.write.mockImplementation(async (key) => {
      if (key === "artifact-5") {
        await setImmediate()
        preview.findMany.mockResolvedValueOnce([
          { ...preview.target, id: "45fe6ae5-0d33-45a3-9eb3-4baea8ee9798" },
        ])
      }
      return { status: "ok" }
    })

    await preview.publish()

    expect(preview.findMany).toHaveBeenCalledTimes(2)
    expect(preview.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["verify-source", "source-unavailable"],
    ["copy-files", "destination-unavailable"],
  ] as const)("bounds concurrent operations and drains %s after failure", async (stage, reason) => {
    const preview = fixture()
    const release = deferred<void>()
    let active = 0
    let peak = 0
    let calls = 0
    async function run<T>(operation: () => Promise<T>): Promise<T> {
      const call = ++calls
      peak = Math.max(peak, ++active)
      try {
        if (call === 1) await release.promise
        if (call === 2) throw rawFailure
        return await operation()
      } finally {
        active--
      }
    }
    if (stage === "verify-source") {
      preview.storage.read.mockImplementation((key) => run(() => preview.sourceRead(key)))
    } else {
      preview.destination.write.mockImplementation(() =>
        run(() => Promise.resolve({ status: "ok" })),
      )
    }
    const publication = preview.publish()
    const outcome = publication.then(
      () => "resolved",
      () => "rejected",
    )
    try {
      const beforeRelease = await Promise.race([outcome, setImmediate("pending")])
      expect(calls).toBeGreaterThan(1)
      expect(peak).toBeLessThanOrEqual(4)
      expect(beforeRelease).toBe("pending")
    } finally {
      release.resolve()
      await outcome
    }

    await expect(publication).rejects.toThrow()
    expect(active).toBe(0)
    preview.expectFailure(stage, reason)
    if (stage === "verify-source") expect(preview.destination.write).not.toHaveBeenCalled()
  })
})
