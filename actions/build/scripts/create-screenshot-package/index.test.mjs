import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"
import { writePng } from "../../test/write-png/index.mjs"

import { digestDistPackage } from "../digest-dist-package/index.mjs"

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
})
