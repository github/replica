import { mkdir, readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { validateBuildOutput } from "./index.ts"

describe("validateBuildOutput()", () => {
  it("validates the retained Controls asset without trusting source definitions", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    const file = path.join(root, "dist", "controls.replica.json")
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        scope: "page",
        controls: [
          {
            id: "title",
            label: "Title",
            type: "text",
            default: "Default",
            binding: { type: "field", selector: "#title" },
          },
        ],
      }),
    )
    expect((await validateBuildOutput(root)).files).toContainEqual(
      expect.objectContaining({ path: "controls.replica.json" }),
    )
    await writeFile(file, '{"version":99}')
    await expect(validateBuildOutput(root)).rejects.toThrow(/controls\.replica\.json/)
    await writeFile(file, " ".repeat(256_001))
    await expect(validateBuildOutput(root)).rejects.toThrow(/controls\.replica\.json/)
  })
  it("returns sorted files and byte counts", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(root, "dist", "assets", "z.js"), "z")
    await writeFile(path.join(root, "dist", ".headers"), "headers")

    expect(await validateBuildOutput(root)).toStrictEqual({
      bytes: 23,
      files: [
        { path: ".headers", bytes: 7 },
        { path: "assets/z.js", bytes: 1 },
        { path: "index.html", bytes: 15 },
      ],
    })
  })

  it("rejects symbolic links", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await symlink("index.html", path.join(root, "dist", "linked.html"))

    await expect(validateBuildOutput(root)).rejects.toThrow(
      new Error(
        "Build output may contain only files and directories. Remove this unsupported entry: linked.html",
      ),
    )
  })

  it("rejects a symbolic link used as dist", async () => {
    const root = await temporaryDirectory()
    const target = await temporaryDirectory()
    await mkdir(path.join(target, "dist", "assets"), { recursive: true })
    await writeFile(path.join(target, "dist", "index.html"), "<!doctype html>")
    await symlink(path.join(target, "dist"), path.join(root, "dist"))

    await expect(validateBuildOutput(root)).rejects.toThrow(
      new Error("Build dist/ must be a directory. Symbolic links and files are not allowed."),
    )
  })

  it("rejects paths that differ only by case", async (context) => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(root, "dist", "logo.svg"), "first")
    await writeFile(path.join(root, "dist", "Logo.svg"), "second")

    const entries = await readdir(path.join(root, "dist"))
    if (!entries.includes("logo.svg") || !entries.includes("Logo.svg")) {
      context.skip("The filesystem cannot create paths that differ only by case.")
      return
    }

    await expect(validateBuildOutput(root)).rejects.toThrow(
      /Build output paths differ only by letter case and cannot both be packaged:/,
    )
  })

  it("rejects unsupported path names", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(root, "dist", "CON"), "reserved")

    await expect(validateBuildOutput(root)).rejects.toThrow(
      new Error(
        "Build output path must use printable ASCII names that work on Windows and Unix: CON",
      ),
    )
  })

  it("enforces all configured build output limits", async () => {
    const entryRoot = await temporaryDirectory()
    await mkdir(path.join(entryRoot, "dist", "assets"), { recursive: true })
    await writeFile(path.join(entryRoot, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(entryRoot, "dist", "extra.txt"), "x")
    await expect(validateBuildOutput(entryRoot, { maxEntries: 2 })).rejects.toThrow(
      new Error("Build output contains more than 2 files and directories."),
    )

    const depthRoot = await temporaryDirectory()
    await mkdir(path.join(depthRoot, "dist", "assets"), { recursive: true })
    await writeFile(path.join(depthRoot, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(depthRoot, "dist", "assets", "z.js"), "z")
    await expect(validateBuildOutput(depthRoot, { maxPathDepth: 1 })).rejects.toThrow(
      new Error("Build output path exceeds the maximum depth of 1: assets/z.js"),
    )

    const fileRoot = await temporaryDirectory()
    await mkdir(path.join(fileRoot, "dist", "assets"), { recursive: true })
    await writeFile(path.join(fileRoot, "dist", "index.html"), "<!doctype html>")
    await expect(validateBuildOutput(fileRoot, { maxFileBytes: 14 })).rejects.toThrow(
      new Error("Build output file must be no larger than 14 bytes: index.html has 15 bytes."),
    )

    const totalRoot = await temporaryDirectory()
    await mkdir(path.join(totalRoot, "dist", "assets"), { recursive: true })
    await writeFile(path.join(totalRoot, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(totalRoot, "dist", "extra.txt"), "x")
    await expect(validateBuildOutput(totalRoot, { maxTotalBytes: 15 })).rejects.toThrow(
      new Error("Build output files must total no more than 15 bytes; found 16."),
    )
  })

  it("rejects non-ASCII output paths", async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, "dist", "assets"), { recursive: true })
    await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>")
    await writeFile(path.join(root, "dist", "ſ.txt"), "ambiguous")

    await expect(validateBuildOutput(root)).rejects.toThrow(
      new Error(
        "Build output path must use printable ASCII names that work on Windows and Unix: ſ.txt",
      ),
    )
  })
})
