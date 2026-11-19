import assert from "node:assert/strict"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { crc32 } from "node:zlib"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"
import { writePng } from "../../test/write-png/index.mjs"

import { digestDistPackage } from "../digest-dist-package/index.mjs"
import { MAX_PACKAGE_BYTES, MAX_SCREENSHOT_BYTES } from "../constants.mjs"

import { createScreenshotPackage } from "./index.mjs"

async function distPackage(html) {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "dist"))
  await writeFile(path.join(root, "dist/index.html"), html)
  return root
}

async function rootScreenshots() {
  const screenshots = await temporaryDirectory()
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["narrow", 390, 844],
  ]) {
    await writePng(path.join(screenshots, `${name}.png`), width, height)
    await writePng(path.join(screenshots, `${name}-dark.png`), width, height)
  }
  return screenshots
}

describe("createScreenshotPackage()", () => {
  it("binds checked screenshots to the exact dist package they depict", async () => {
    const dist = await distPackage("<!doctype html>")
    const output = path.join(await temporaryDirectory(), "package")

    const { distDigest } = await createScreenshotPackage(await rootScreenshots(), dist, output)

    assert.match(distDigest, /^sha256:[0-9a-f]{64}$/)
    assert.equal(distDigest, await digestDistPackage(dist))
    assert.deepEqual(JSON.parse(await readFile(path.join(output, "screenshots.json"), "utf8")), {
      version: 1,
      distDigest,
    })
    await readFile(path.join(output, "screenshots/desktop-dark.png"))
    assert.notEqual(await digestDistPackage(await distPackage("<!doctype html><p>")), distDigest)
  })

  it("requires screenshots for every template in the dist package", async () => {
    const dist = await distPackage("<!doctype html>")
    await writeFile(
      path.join(dist, "templates.json"),
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Account",
            description: "Edit settings.",
            path: "/settings",
          },
        ],
      }),
    )

    await assert.rejects(
      createScreenshotPackage(
        await rootScreenshots(),
        dist,
        path.join(await temporaryDirectory(), "package"),
      ),
      /templates\/settings/,
    )
  })

  it("counts the screenshot manifest at the package byte limit", async () => {
    const root = await temporaryDirectory()
    try {
      const dist = path.join(root, "package")
      const screenshots = path.join(root, "screenshots")
      const output = path.join(root, "output")
      await mkdir(path.join(dist, "dist"), { recursive: true })
      await writeFile(path.join(dist, "dist/index.html"), "<!doctype html>")
      await writeFile(
        path.join(dist, "templates.json"),
        JSON.stringify({
          version: 1,
          templates: ["one", "two"].map((id) => ({
            id,
            name: id,
            category: "Account",
            description: "Settings.",
            path: `/${id}`,
          })),
        }),
      )
      const digest = await digestDistPackage(dist)
      const manifestBytes = Buffer.byteLength(JSON.stringify({ version: 1, distDigest: digest }))
      const names = ["", "templates/one", "templates/two"].flatMap((directory) =>
        [
          ["desktop.png", 1440, 900],
          ["narrow.png", 390, 844],
        ].map(([name, width, height]) => [path.join(directory, name), width, height]),
      )
      async function writeSizedPng(name, width, height, size) {
        const file = path.join(screenshots, name)
        await mkdir(path.dirname(file), { recursive: true })
        await writePng(file, width, height)
        const original = await readFile(file)
        const chunk = Buffer.alloc(size - original.length)
        chunk.writeUInt32BE(chunk.length - 12, 0)
        chunk.write("vpAg", 4)
        chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
        await writeFile(
          file,
          Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]),
        )
      }
      for (const [index, [name, width, height]] of names.entries()) {
        await writeSizedPng(
          name,
          width,
          height,
          MAX_SCREENSHOT_BYTES - (index === 0 ? manifestBytes : 0),
        )
      }

      const result = await createScreenshotPackage(screenshots, dist, output)
      assert.equal(result.bytes + manifestBytes, MAX_PACKAGE_BYTES)
      await writeSizedPng(
        names[0][0],
        names[0][1],
        names[0][2],
        MAX_SCREENSHOT_BYTES - manifestBytes + 1,
      )
      await assert.rejects(createScreenshotPackage(screenshots, dist, output), /150 MiB/)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
