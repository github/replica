import { setImmediate } from "node:timers/promises"
import { describe, expect, it, vi } from "vitest"

import { deferred } from "../../../../test/ws/deferred"
import { privatePreviewAddress } from "../../../utils/private-preview-address"
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

function fixture() {
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
  const findMany = vi.fn().mockResolvedValue([
    {
      id: buildId,
      state: "successful",
      privatePreviewState: "pending",
      artifacts: [{ id: "index" }],
      prototype: {
        replica: false,
        branchName: "proto/demo",
        startPage: "/",
        repository: { id: "repo", removedAt: null, localPath: null, defaultBranch: "main" },
      },
    },
  ])
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
  const dependencies: GitHubBuildImportDependencies = {
    database: {
      build: { findMany, findUnique, updateMany },
    } as unknown as GitHubBuildImportDependencies["database"],
    storage,
    logger,
    privatePreviewWriter: { repositoryId: address.repositoryId, storage: destination },
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
    storage,
    sourceRead,
    destination,
    manifestKey: artifacts.at(-1)!.storageKey,
    publish: () => publishGitHubBuildPreview(dependencies, buildId, address),
    expectFailure,
  }
}

describe("publishGitHubBuildPreview()", () => {
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

  it("reports a conflict when an immutable destination already has different bytes", async () => {
    const preview = fixture()
    preview.destination.write.mockResolvedValueOnce({ status: "already-exists" })
    preview.destination.read.mockResolvedValueOnce({ status: "ok", bytes: Buffer.from("other") })

    await expect(preview.publish()).rejects.toThrow()

    preview.expectFailure("copy-files", "destination-conflict")
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
