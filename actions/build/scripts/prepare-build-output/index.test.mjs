import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { prepareBuildOutput } from "./index.mjs"

async function keptDestination(root) {
  const output = path.join(root, "normalized")
  await mkdir(output)
  await writeFile(path.join(output, "keep.txt"), "keep")
  return output
}

describe("prepareBuildOutput()", () => {
  for (const outputDirectory of ["dist", "website/public", "./build", "build/"]) {
    it(`normalizes ${outputDirectory} to dist without moving the source`, async () => {
      const root = await temporaryDirectory()
      const output = path.join(root, "normalized")
      const source = path.join(root, outputDirectory)
      await mkdir(source, { recursive: true })
      await writeFile(path.join(source, "index.html"), "<title>Local build</title>")
      await writeFile(path.join(source, ".headers"), "headers")

      await prepareBuildOutput(root, outputDirectory, output)

      assert.deepEqual(await readdir(output), ["dist"])
      assert.equal(
        await readFile(path.join(output, "dist", "index.html"), "utf8"),
        "<title>Local build</title>",
      )
      assert.equal(await readFile(path.join(source, ".headers"), "utf8"), "headers")
      assert.equal(await readFile(path.join(output, "dist", ".headers"), "utf8"), "headers")
    })
  }

  for (const outputDirectory of [
    "",
    "/outside",
    "../outside",
    "website/../public",
    "C:\\outside",
    "website\\public",
  ]) {
    it(`rejects unsafe output directory ${JSON.stringify(outputDirectory)} without touching the destination`, async () => {
      const root = await temporaryDirectory()
      const output = await keptDestination(root)

      await assert.rejects(prepareBuildOutput(root, outputDirectory, output), /output-directory/)

      assert.equal(await readFile(path.join(output, "keep.txt"), "utf8"), "keep")
    })
  }

  for (const location of ["leaf", "ancestor"]) {
    it(`rejects a symbolic link at the ${location}`, async () => {
      const root = await temporaryDirectory()
      const external = await temporaryDirectory()
      await mkdir(path.join(external, "public"))
      await writeFile(path.join(external, "public", "index.html"), "<title>Outside</title>")
      if (location === "leaf") {
        await mkdir(path.join(root, "website"))
        await symlink(path.join(external, "public"), path.join(root, "website", "public"))
      } else {
        await symlink(external, path.join(root, "website"))
      }

      await assert.rejects(
        prepareBuildOutput(root, "website/public", path.join(root, "normalized")),
        /not symbolic links or files/,
      )
      assert.equal(
        await readFile(path.join(external, "public", "index.html"), "utf8"),
        "<title>Outside</title>",
      )
    })
  }

  for (const missing of ["website", "website/public"]) {
    it(`explains a missing configured folder when ${missing} is absent`, async () => {
      const root = await temporaryDirectory()
      const output = await keptDestination(root)
      if (missing === "website/public") await mkdir(path.join(root, "website"))

      await assert.rejects(
        prepareBuildOutput(root, "website/public", output),
        new Error(
          'Build output folder "website/public" is missing. Build it first or correct output-directory.',
        ),
      )
      assert.equal(await readFile(path.join(output, "keep.txt"), "utf8"), "keep")
    })
  }

  for (const destination of ["dist", "dist/nested", "."]) {
    it(`rejects overlapping destination ${destination} before deleting source files`, async () => {
      const root = await temporaryDirectory()
      await mkdir(path.join(root, "dist"))
      await writeFile(path.join(root, "dist", "index.html"), "source")

      await assert.rejects(
        prepareBuildOutput(root, "dist", path.join(root, destination)),
        /must not overlap/,
      )
      assert.equal(await readFile(path.join(root, "dist", "index.html"), "utf8"), "source")
    })
  }

  it("requires index.html and validates retained Controls before replacing the destination", async () => {
    const root = await temporaryDirectory()
    const output = await keptDestination(root)
    await mkdir(path.join(root, "public"))
    await assert.rejects(prepareBuildOutput(root, "public", output), /public\/index\.html/)
    await writeFile(path.join(root, "public", "index.html"), "source")
    await writeFile(path.join(root, "public", "controls.replica.json"), '{"version":99}')
    await assert.rejects(prepareBuildOutput(root, "public", output), /Controls/)
    assert.equal(await readFile(path.join(output, "keep.txt"), "utf8"), "keep")
  })

  it("accepts all three CLI paths and creates the fixed dist layout", async () => {
    const root = await temporaryDirectory()
    const output = path.join(root, "normalized")
    await mkdir(path.join(root, "site"))
    await writeFile(path.join(root, "site", "index.html"), "CLI output")

    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("./index.mjs", import.meta.url)),
      "--root",
      root,
      "--output-directory",
      "site",
      "--output",
      output,
    ])

    assert.equal(await readFile(path.join(output, "dist", "index.html"), "utf8"), "CLI output")
    assert.equal(await readFile(path.join(root, "site", "index.html"), "utf8"), "CLI output")
  })
})
