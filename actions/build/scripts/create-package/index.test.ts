import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"
import { writePng } from "../../test/write-png/index.ts"

import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_HEIGHT } from "../constants.ts"

import { createPackage } from "./index.ts"

describe("createPackage()", () => {
  it("rejects incomplete dark captures instead of publishing a partial set", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)
    await writePng(path.join(screenshots, "desktop-dark.png"), 1440, 900)

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error("Package is missing dark screenshots: narrow-dark.png."),
    )
  })

  it("checks dark screenshots against the same dimension limits", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)
    await writePng(path.join(screenshots, "desktop-dark.png"), 1280, 900)
    await writePng(path.join(screenshots, "narrow-dark.png"), 390, 844)

    await assert.rejects(
      createPackage(root, screenshots, output),
      /Screenshot desktop-dark.png must be 1440 pixels wide/,
    )
  })

  it("copies checked dist output and screenshots", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    const html = Buffer.from("<!doctype html>")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), html)
    await writeFile(path.join(root, "dist", ".headers"), "headers")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 1900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 2100)
    const files = await createPackage(root, screenshots, output)

    assert.equal(files, 2)
    assert.equal(await readFile(path.join(output, "dist", ".headers"), "utf8"), "headers")
    assert.deepEqual(await readFile(path.join(output, "dist", "index.html")), html)
    assert.deepEqual(
      await readFile(path.join(output, "screenshots", "desktop.png")),
      await readFile(path.join(screenshots, "desktop.png")),
    )
    assert.deepEqual(
      await readFile(path.join(output, "screenshots", "narrow.png")),
      await readFile(path.join(screenshots, "narrow.png")),
    )
  })

  it("rejects a truncated PNG", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(screenshots, "desktop.png"), Buffer.alloc(24))
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error("Screenshot desktop.png must be a complete PNG file."),
    )
  })

  it("rejects screenshots with the wrong width", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1280, 720)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error(
        "Screenshot desktop.png must be 1440 pixels wide and at least 900 pixels high; found 1280 by 720.",
      ),
    )
  })

  it("rejects screenshots shorter than their viewport", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 843)

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error(
        "Screenshot narrow.png must be 390 pixels wide and at least 844 pixels high; found 390 by 843.",
      ),
    )
  })

  it("rejects oversized PNG dimensions before decoding", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    const desktop = path.join(screenshots, "desktop.png")
    await writePng(desktop, 1440, 900)
    const bytes = await readFile(desktop)
    bytes.writeUInt32BE(MAX_SCREENSHOT_HEIGHT + 1, 20)
    await writeFile(desktop, bytes)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error(`Screenshot desktop.png must be at most 1440 by ${MAX_SCREENSHOT_HEIGHT} pixels.`),
    )
  })

  it("rejects a screenshot larger than its byte limit", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(screenshots, "desktop.png"), Buffer.alloc(MAX_SCREENSHOT_BYTES + 1))

    await assert.rejects(
      createPackage(root, screenshots, output),
      new Error(
        `Screenshot desktop.png must be between 1 and ${MAX_SCREENSHOT_BYTES} bytes; found ${MAX_SCREENSHOT_BYTES + 1}.`,
      ),
    )
  })

  it("requires both screenshots for each template declared in the capture metadata", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)
    await mkdir(path.join(screenshots, "templates/settings"), { recursive: true })
    await writePng(path.join(screenshots, "templates/settings/desktop.png"), 1440, 900)
    await writeFile(
      path.join(screenshots, "templates.json"),
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Configuration",
            description: "Edit account settings.",
            path: "/settings",
          },
        ],
      }),
    )
    await assert.rejects(createPackage(root, screenshots, output), { code: "ENOENT" })
  })

  it("checks template screenshot dimensions using the same rules as the root screenshot", async () => {
    const root = await temporaryDirectory()
    const screenshots = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html>")
    await writePng(path.join(screenshots, "desktop.png"), 1440, 900)
    await writePng(path.join(screenshots, "narrow.png"), 390, 844)
    await mkdir(path.join(screenshots, "templates/settings"), { recursive: true })
    await writePng(path.join(screenshots, "templates/settings/desktop.png"), 1280, 900)
    await writeFile(
      path.join(screenshots, "templates.json"),
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Configuration",
            description: "Edit account settings.",
            path: "/settings",
          },
        ],
      }),
    )
    await assert.rejects(
      createPackage(root, screenshots, output),
      /Screenshot templates\/settings\/desktop.png must be 1440 pixels wide/,
    )
  })
})
