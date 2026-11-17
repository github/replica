import { describe, expect, it, vi } from "vitest"

import { readBuildPreviewFile } from "."

describe("readBuildPreviewFile()", () => {
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
