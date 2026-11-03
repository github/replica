import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { prepareBuildOutput } from "./index.ts"

describe("prepareBuildOutput()", () => {
  it.each(["dist", "website/public", "./build", "build/"])(
    "normalizes %s to dist without requiring npm repository files or moving the source",
    async (outputDirectory) => {
      const root = await temporaryDirectory()
      const output = path.join(root, "normalized")
      const source = path.join(root, outputDirectory)
      await mkdir(source, { recursive: true })
      await writeFile(path.join(source, "index.html"), "<title>Local build</title>")
      await writeFile(path.join(source, ".headers"), "headers")

      await prepareBuildOutput(root, outputDirectory, output)

      expect(await readdir(output)).toStrictEqual(["dist"])
      expect(await readFile(path.join(output, "dist", "index.html"), "utf8")).toBe(
        "<title>Local build</title>",
      )
      expect(await readFile(path.join(source, ".headers"), "utf8")).toBe("headers")
      expect(await readFile(path.join(output, "dist", ".headers"), "utf8")).toBe("headers")
    },
  )

  it.each(["", "/outside", "../outside", "website/../public", "C:\\outside", "website\\public"])(
    "rejects unsafe output directory %j without touching the destination",
    async (outputDirectory) => {
      const root = await temporaryDirectory()
      const output = path.join(root, "normalized")
      await mkdir(output)
      await writeFile(path.join(output, "keep.txt"), "keep")

      await expect(prepareBuildOutput(root, outputDirectory, output)).rejects.toThrow()

      expect(await readFile(path.join(output, "keep.txt"), "utf8")).toBe("keep")
    },
  )

  it.each(["leaf", "ancestor"])("rejects a symbolic link at the %s", async (location) => {
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

    await expect(
      prepareBuildOutput(root, "website/public", path.join(root, "normalized")),
    ).rejects.toThrow()
    expect(await readFile(path.join(external, "public", "index.html"), "utf8")).toBe(
      "<title>Outside</title>",
    )
  })

  it.each(["dist", "dist/nested", "."])(
    "rejects overlapping destination %s before deleting source files",
    async (destination) => {
      const root = await temporaryDirectory()
      await mkdir(path.join(root, "dist"))
      await writeFile(path.join(root, "dist", "index.html"), "source")

      await expect(prepareBuildOutput(root, "dist", path.join(root, destination))).rejects.toThrow()
      expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("source")
    },
  )

  it("requires index.html and validates retained Controls before replacing the destination", async () => {
    const root = await temporaryDirectory()
    const output = path.join(root, "normalized")
    await mkdir(path.join(root, "public"))
    await mkdir(output)
    await writeFile(path.join(output, "keep.txt"), "keep")
    await expect(prepareBuildOutput(root, "public", output)).rejects.toThrow(/index\.html/)
    await writeFile(path.join(root, "public", "index.html"), "source")
    await writeFile(path.join(root, "public", "controls.replica.json"), '{"version":99}')
    await expect(prepareBuildOutput(root, "public", output)).rejects.toThrow(/controls|Controls/)
    expect(await readFile(path.join(output, "keep.txt"), "utf8")).toBe("keep")
  })

  it("accepts all three CLI paths and creates the fixed dist layout", async () => {
    const root = await temporaryDirectory()
    const output = path.join(root, "normalized")
    await mkdir(path.join(root, "site"))
    await writeFile(path.join(root, "site", "index.html"), "CLI output")

    await promisify(execFile)(process.execPath, [
      path.resolve("scripts/prepare-build-output/index.ts"),
      "--root",
      root,
      "--output-directory",
      "site",
      "--output",
      output,
    ])

    expect(await readFile(path.join(output, "dist", "index.html"), "utf8")).toBe("CLI output")
    expect(await readFile(path.join(root, "site", "index.html"), "utf8")).toBe("CLI output")
  })
})
