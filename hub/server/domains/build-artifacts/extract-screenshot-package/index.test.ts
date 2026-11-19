import { describe, expect, it } from "vitest"

import { createZipArchive } from "../../../test/create-zip-archive/index.ts"
import { BuildPackageError } from "../errors.ts"
import { extractScreenshotPackage } from "./index.ts"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const distDigest = `sha256:${"a".repeat(64)}`
const manifest = { name: "screenshots.json", bytes: JSON.stringify({ version: 1, distDigest }) }

describe("extractScreenshotPackage", () => {
  it("returns screenshots with the dist digest they depict", () => {
    const result = extractScreenshotPackage(
      createZipArchive([
        manifest,
        { name: "screenshots/desktop.png", bytes: png },
        { name: "screenshots/templates/home/narrow-dark.png", bytes: png },
      ]),
    )

    expect(result.distDigest).toBe(distDigest)
    expect(result.files.map((file) => file.path)).toEqual([
      "screenshots/desktop.png",
      "screenshots/templates/home/narrow-dark.png",
    ])
  })

  it.each([
    ["a missing manifest", [{ name: "screenshots/desktop.png", bytes: png }]],
    [
      "an invalid digest",
      [
        { name: "screenshots.json", bytes: JSON.stringify({ version: 1, distDigest: "x" }) },
        { name: "screenshots/desktop.png", bytes: png },
      ],
    ],
    ["no screenshots", [manifest]],
    ["dist files", [manifest, { name: "dist/index.html" }]],
    ["non-PNG screenshots", [manifest, { name: "screenshots/desktop.png", bytes: "x" }]],
  ])("rejects %s", (_label, entries) => {
    expect(() => extractScreenshotPackage(createZipArchive(entries))).toThrow(BuildPackageError)
  })
})
