import assert from "node:assert/strict"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { createDistPackage } from "./index.mjs"

const template = {
  id: "settings",
  name: "Settings",
  category: "Configuration",
  description: "Edit account settings.",
  path: "/settings",
}

describe("createDistPackage()", () => {
  it("packages dist with checked repository templates and no screenshots", async () => {
    const root = await temporaryDirectory()
    const configRoot = await temporaryDirectory()
    const output = path.join(await temporaryDirectory(), "package")
    await mkdir(path.join(root, "dist/assets"), { recursive: true })
    await writeFile(path.join(root, "dist/index.html"), "<!doctype html>")
    await writeFile(path.join(root, "dist/assets/app.js"), "export {}")
    await mkdir(path.join(configRoot, ".github"))
    await writeFile(
      path.join(configRoot, ".github/replica.json"),
      JSON.stringify({ version: 1, hub: { origin: "https://hub.example" }, templates: [template] }),
    )

    assert.equal(await createDistPackage(root, configRoot, output), 2)

    assert.deepEqual((await readdir(output)).sort(), ["dist", "templates.json"])
    assert.equal(await readFile(path.join(output, "dist/assets/app.js"), "utf8"), "export {}")
    assert.deepEqual(JSON.parse(await readFile(path.join(output, "templates.json"), "utf8")), {
      version: 1,
      templates: [template],
    })
  })

  it("names the missing index file instead of publishing an unusable preview", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "dist/app.js"), "export {}")

    await assert.rejects(
      createDistPackage(root, root, path.join(await temporaryDirectory(), "package")),
      /index\.html/,
    )
  })
})
