import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

// The digest must match the build action, which writes it into screenshots.json.
import { createZipArchive } from "../../../test/create-zip-archive/index.ts"
import { BuildPackageError } from "../errors.ts"
import { extractDistPackage } from "./index.ts"

const templates = JSON.stringify({
  version: 1,
  templates: [
    { id: "home", name: "Home", category: "Pages", description: "Home page.", path: "/home" },
  ],
})
const digestModule = new URL(
  "../../../../../actions/build/scripts/digest-dist-package/index.mjs",
  import.meta.url,
).href
const { digestDistPackage } = (await import(digestModule)) as {
  digestDistPackage: (root: string) => Promise<string>
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

describe("extractDistPackage", () => {
  it("classifies files and computes the same digest as the build action", async () => {
    const files = {
      "dist/index.html": "<h1>Home</h1>",
      "dist/assets/app.js": "console.log(1)",
      "dist/z.css": "body{}",
    }
    const archive = createZipArchive([
      ...Object.entries(files).map(([name, bytes]) => ({ name, bytes })),
      { name: "templates.json", bytes: templates },
      { name: "screenshots/desktop.png", bytes: png },
    ])

    const result = extractDistPackage(archive)

    expect(result.files.map((file) => [file.path, file.kind])).toEqual([
      ["dist/assets/app.js", "dist"],
      ["dist/index.html", "dist"],
      ["dist/z.css", "dist"],
      ["screenshots/desktop.png", "screenshot"],
      ["templates.json", "manifest"],
    ])
    const root = await mkdtemp(path.join(tmpdir(), "replica-digest-"))
    try {
      for (const [name, bytes] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true })
        await writeFile(path.join(root, name), bytes)
      }
      await writeFile(path.join(root, "templates.json"), templates)
      expect(result.distDigest).toBe(await digestDistPackage(root))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ["a missing index page", [{ name: "dist/app.js", bytes: "1" }]],
    ["unsafe paths", [{ name: "dist/index.html" }, { name: "dist/../escape.html" }]],
    ["unexpected files", [{ name: "dist/index.html" }, { name: "README.md" }]],
    ["invalid templates", [{ name: "dist/index.html" }, { name: "templates.json", bytes: "{}" }]],
    [
      "screenshots that are not PNG images",
      [{ name: "dist/index.html" }, { name: "screenshots/desktop.png", bytes: "x" }],
    ],
    ["deep paths", [{ name: "dist/index.html" }, { name: `dist/${"a/".repeat(20)}index.html` }]],
  ])("rejects %s", (_label, entries) => {
    expect(() => extractDistPackage(createZipArchive(entries))).toThrow(BuildPackageError)
  })

  describe("size limits shared with the build action", () => {
    const mebibyte = 1024 * 1024
    function dist() {
      return [0, 1, 2, 3].map((index) => ({
        name: index === 0 ? "dist/index.html" : `dist/chunk-${index}.js`,
        bytes: Buffer.alloc(25 * mebibyte),
      }))
    }
    function screenshot(name: string, bytes: number) {
      return {
        name: `screenshots/${name}.png`,
        bytes: Buffer.concat([png, Buffer.alloc(bytes - png.length)]),
      }
    }

    it("accepts a legacy package with full dist output and screenshots", () => {
      const archive = createZipArchive([
        ...dist(),
        screenshot("desktop", 25 * mebibyte),
        screenshot("narrow", 25 * mebibyte),
      ])

      expect(extractDistPackage(archive).files).toHaveLength(6)
    })

    it("rejects dist output larger than the build action allows", () => {
      expect(() =>
        extractDistPackage(createZipArchive([...dist(), { name: "dist/extra.js", bytes: "1" }])),
      ).toThrow("The dist files exceed their size limit.")
    })

    it("rejects a package larger than the build action allows", () => {
      const archive = createZipArchive([
        ...dist(),
        screenshot("desktop", 25 * mebibyte),
        screenshot("narrow", 25 * mebibyte - png.length + 1),
        screenshot("desktop-dark", png.length),
      ])

      expect(() => extractDistPackage(archive)).toThrow(
        "The extracted package exceeds its size limit.",
      )
    })
  })
})
