import { describe, expect, it, vi } from "vitest"

import { readBuildPreviewFile } from "."

describe("readBuildPreviewFile()", () => {
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
