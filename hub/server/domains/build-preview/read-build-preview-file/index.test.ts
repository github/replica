import { describe, expect, it, vi } from "vitest"

import type { ReadBuildPreviewFileDependencies } from "./types"
import { readBuildPreviewFile } from "."

function mountedAssetFixture(basePath?: string) {
  const buildId = "00000000-0000-4000-8000-000000000001"
  const assetBytes = new TextEncoder().encode("body { color: black; }")
  const markerBytes = new TextEncoder().encode(JSON.stringify({ basePath }))
  const findArtifact = vi.fn<ReadBuildPreviewFileDependencies["findArtifact"]>(
    (authorizedBuildId, path) => {
      if (authorizedBuildId !== buildId) return Promise.resolve(null)
      if (path === "dist/replica-preview-base.json" && basePath !== undefined) {
        return Promise.resolve({ storageKey: "base-marker", byteLength: markerBytes.length })
      }
      if (path === "dist/assets/style.css") {
        return Promise.resolve({ storageKey: "style", byteLength: assetBytes.length })
      }
      return Promise.resolve(null)
    },
  )
  const read = vi.fn<ReadBuildPreviewFileDependencies["storage"]["read"]>((key) => {
    if (key === "base-marker") return Promise.resolve({ status: "ok", bytes: markerBytes })
    if (key === "style") return Promise.resolve({ status: "ok", bytes: assetBytes })
    return Promise.resolve({ status: "not-found" })
  })
  return {
    buildId,
    assetBytes,
    read,
    dependencies: {
      findArtifact,
      storage: { isReady: vi.fn(), read, write: vi.fn(), delete: vi.fn() },
    },
  }
}

describe("readBuildPreviewFile()", () => {
  it.each([
    { preview: "legacy", distOnly: false },
    { preview: "hosted public", distOnly: true },
  ])("resolves the declared mount for a $preview Build", async ({ distOnly }) => {
    const mount = "/previews/github/901/1201/"
    const { buildId, assetBytes, dependencies } = mountedAssetFixture(mount)

    await expect(
      readBuildPreviewFile(
        { buildId, acceptsHtml: false, distOnly, requestPath: `${mount}assets/style.css` },
        dependencies,
      ),
    ).resolves.toMatchObject({ status: "ok", bytes: assetBytes })
    expect(dependencies.findArtifact).toHaveBeenCalledWith(
      buildId,
      "dist/replica-preview-base.json",
    )
    expect(dependencies.findArtifact).toHaveBeenCalledWith(buildId, "dist/assets/style.css")
  })

  it.each([
    {
      condition: "a different run",
      mount: "/previews/github/901/1202/",
      marker: "/previews/github/901/1201/",
    },
    {
      condition: "a different repository",
      mount: "/previews/github/902/1201/",
      marker: "/previews/github/901/1201/",
    },
    { condition: "an undeclared mount", mount: "/previews/github/901/1201/", marker: undefined },
  ])("does not alias dist assets for $condition", async ({ mount, marker }) => {
    const { buildId, dependencies, read } = mountedAssetFixture(marker)

    await expect(
      readBuildPreviewFile(
        { buildId, acceptsHtml: false, requestPath: `${mount}assets/style.css` },
        dependencies,
      ),
    ).resolves.toEqual({ status: "not-found" })
    expect(read).not.toHaveBeenCalledWith("style")
  })

  it("keeps serving unprefixed dist assets without a mount declaration", async () => {
    const { buildId, assetBytes, dependencies } = mountedAssetFixture()

    await expect(
      readBuildPreviewFile(
        { buildId, acceptsHtml: false, requestPath: "/assets/style.css" },
        dependencies,
      ),
    ).resolves.toMatchObject({ status: "ok", bytes: assetBytes })
  })

  it("serves directory-style routes through the application entry point", async () => {
    const bytes = new TextEncoder().encode("<h1>Checkout</h1>")
    const findArtifact = vi.fn().mockImplementation((_buildId: string, path: string) => {
      if (path === "dist/index.html") {
        return Promise.resolve({
          storageKey: "index-key",
          byteLength: bytes.byteLength,
        })
      }
      return Promise.resolve(null)
    })

    const result = await readBuildPreviewFile(
      {
        acceptsHtml: true,
        buildId: "00000000-0000-4000-8000-000000000001",
        requestPath: "/checkout/",
      },
      {
        findArtifact,
        storage: {
          isReady: vi.fn(),
          read: vi.fn().mockResolvedValue({
            status: "ok",
            bytes,
          }),
          write: vi.fn(),
          delete: vi.fn(),
        },
      },
    )

    expect(result).toMatchObject({
      status: "ok",
      contentType: "text/html; charset=utf-8",
      html: true,
    })
    expect(findArtifact).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "dist/checkout/index.html",
    )
  })

  it("serves dotted routes declared by the template manifest", async () => {
    const manifest = {
      version: 1,
      templates: [
        {
          id: "release-notes",
          name: "Release notes",
          category: "Documentation",
          description: "Review the release notes.",
          path: "/release/v2.0",
        },
      ],
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
    const htmlBytes = new TextEncoder().encode("<h1>Release notes</h1>")
    const findArtifact = vi.fn().mockImplementation((_buildId: string, path: string) => {
      const artifacts = {
        "templates.json": { storageKey: "manifest-key", byteLength: manifestBytes.byteLength },
        "dist/index.html": { storageKey: "index-key", byteLength: htmlBytes.byteLength },
      }
      return Promise.resolve(artifacts[path as keyof typeof artifacts] ?? null)
    })

    const result = await readBuildPreviewFile(
      {
        acceptsHtml: true,
        buildId: "00000000-0000-4000-8000-000000000001",
        requestPath: "/release/v2.0",
      },
      {
        findArtifact,
        storage: {
          isReady: vi.fn(),
          read: vi.fn().mockImplementation((storageKey: string) =>
            Promise.resolve(
              storageKey === "manifest-key"
                ? {
                    status: "ok",
                    bytes: manifestBytes,
                  }
                : {
                    status: "ok",
                    bytes: htmlBytes,
                  },
            ),
          ),
          write: vi.fn(),
          delete: vi.fn(),
        },
      },
    )

    expect(result).toMatchObject({
      status: "ok",
      contentType: "text/html; charset=utf-8",
      html: true,
    })
  })

  it("does not replace a missing asset with the application entry point", async () => {
    const findArtifact = vi.fn().mockResolvedValue(null)

    await expect(
      readBuildPreviewFile(
        {
          acceptsHtml: true,
          buildId: "00000000-0000-4000-8000-000000000001",
          requestPath: "/assets/missing.js",
        },
        {
          findArtifact,
          storage: {
            isReady: vi.fn(),
            read: vi.fn(),
            write: vi.fn(),
            delete: vi.fn(),
          },
        },
      ),
    ).resolves.toEqual({ status: "not-found" })
    expect(findArtifact).not.toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "dist/index.html",
    )
  })

  it.each(["asset", "template manifest"] as const)(
    "rejects %s bytes that exceed the saved artifact size",
    async (artifactKind) => {
      const read = vi.fn().mockResolvedValue({
        status: "ok",
        bytes: new TextEncoder().encode(
          artifactKind === "asset"
            ? "asset bytes"
            : JSON.stringify({ templates: [{ path: "/release/v2.0" }] }),
        ),
      })
      const findArtifact = vi
        .fn()
        .mockImplementation((_buildId: string, artifactPath: string) =>
          Promise.resolve(
            artifactKind === "asset" || artifactPath === "templates.json"
              ? { storageKey: "underreported-key", byteLength: 1 }
              : null,
          ),
        )

      const result = await readBuildPreviewFile(
        {
          acceptsHtml: artifactKind === "template manifest",
          buildId: "00000000-0000-4000-8000-000000000001",
          requestPath: artifactKind === "asset" ? "/asset.bin" : "/release/v2.0",
        },
        {
          findArtifact,
          storage: { isReady: vi.fn(), read, write: vi.fn(), delete: vi.fn() },
        },
      )

      expect(result).toEqual({ status: "unavailable" })
      expect(read).toHaveBeenCalledOnce()
    },
  )

  it("decodes one URL path layer before artifact lookup", async () => {
    const findArtifact = vi.fn().mockResolvedValue({
      storageKey: "banner-key",
      byteLength: 3,
    })

    await expect(
      readBuildPreviewFile(
        {
          acceptsHtml: false,
          buildId: "00000000-0000-4000-8000-000000000001",
          requestPath: "/assets/banner%20image.png",
        },
        {
          findArtifact,
          storage: {
            isReady: vi.fn(),
            read: vi.fn().mockResolvedValue({ status: "ok", bytes: Uint8Array.of(1, 2, 3) }),
            write: vi.fn(),
            delete: vi.fn(),
          },
        },
      ),
    ).resolves.toMatchObject({ status: "ok", contentType: "image/png" })
    expect(findArtifact).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "dist/assets/banner image.png",
    )
  })

  it("rejects malformed or unsafe decoded paths before lookup", async () => {
    const findArtifact = vi.fn()
    const dependencies = {
      findArtifact,
      storage: {
        isReady: vi.fn(),
        read: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
      },
    }

    for (const requestPath of ["/assets/%", "/assets/%2e%2e/secret.txt"]) {
      await expect(
        readBuildPreviewFile(
          {
            acceptsHtml: false,
            buildId: "00000000-0000-4000-8000-000000000001",
            requestPath,
          },
          dependencies,
        ),
      ).resolves.toEqual({ status: "not-found" })
    }
    expect(findArtifact).not.toHaveBeenCalled()
  })
})
