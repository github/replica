import assert from "node:assert/strict"
import { readdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { buildRoot } from "../../test/build-root/index.ts"
import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { validateBuildOutput } from "./index.ts"

describe("validateBuildOutput()", () => {
  it("validates the retained Controls asset without trusting source definitions", async () => {
    const root = await buildRoot()
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
    assert.ok(
      (await validateBuildOutput(root)).files.some(
        (entry) => entry.path === "controls.replica.json",
      ),
    )
    await writeFile(file, '{"version":99}')
    await assert.rejects(validateBuildOutput(root), /controls\.replica\.json/)
    await writeFile(file, " ".repeat(256_001))
    await assert.rejects(validateBuildOutput(root), /controls\.replica\.json/)
  })
  it("returns sorted files and byte counts", async () => {
    const root = await buildRoot()
    await writeFile(path.join(root, "dist", "assets", "z.js"), "z")
    await writeFile(path.join(root, "dist", ".headers"), "headers")

    assert.deepEqual(await validateBuildOutput(root), {
      bytes: 23,
      files: [
        { path: ".headers", bytes: 7 },
        { path: "assets/z.js", bytes: 1 },
        { path: "index.html", bytes: 15 },
      ],
    })
  })

  it("rejects symbolic links", async () => {
    const root = await buildRoot()
    await symlink("index.html", path.join(root, "dist", "linked.html"))

    await assert.rejects(
      validateBuildOutput(root),
      new Error(
        "Build output may contain only files and directories. Remove this unsupported entry: linked.html",
      ),
    )
  })

  it("rejects a symbolic link used as dist", async () => {
    const root = await temporaryDirectory()
    const target = await buildRoot()
    await symlink(path.join(target, "dist"), path.join(root, "dist"))

    await assert.rejects(
      validateBuildOutput(root),
      new Error("Build dist/ must be a directory. Symbolic links and files are not allowed."),
    )
  })

  it("rejects paths that differ only by case", async (context) => {
    const root = await buildRoot()
    await writeFile(path.join(root, "dist", "logo.svg"), "first")
    await writeFile(path.join(root, "dist", "Logo.svg"), "second")

    const entries = await readdir(path.join(root, "dist"))
    if (!entries.includes("logo.svg") || !entries.includes("Logo.svg")) {
      context.skip("The filesystem cannot create paths that differ only by case.")
      return
    }

    await assert.rejects(
      validateBuildOutput(root),
      /Build output paths differ only by letter case and cannot both be packaged:/,
    )
  })

  it("rejects unsupported path names", async () => {
    const root = await buildRoot()
    await writeFile(path.join(root, "dist", "CON"), "reserved")

    await assert.rejects(
      validateBuildOutput(root),
      new Error(
        "Build output path must use printable ASCII names that work on Windows and Unix: CON",
      ),
    )
  })

  it("enforces all configured build output limits", async () => {
    const entryRoot = await buildRoot()
    await writeFile(path.join(entryRoot, "dist", "extra.txt"), "x")
    await assert.rejects(
      validateBuildOutput(entryRoot, { maxEntries: 2 }),
      new Error("Build output contains more than 2 files and directories."),
    )

    const depthRoot = await buildRoot()
    await writeFile(path.join(depthRoot, "dist", "assets", "z.js"), "z")
    await assert.rejects(
      validateBuildOutput(depthRoot, { maxPathDepth: 1 }),
      new Error("Build output path exceeds the maximum depth of 1: assets/z.js"),
    )

    const fileRoot = await buildRoot()
    await assert.rejects(
      validateBuildOutput(fileRoot, { maxFileBytes: 14 }),
      new Error("Build output file must be no larger than 14 bytes: index.html has 15 bytes."),
    )

    const totalRoot = await buildRoot()
    await writeFile(path.join(totalRoot, "dist", "extra.txt"), "x")
    await assert.rejects(
      validateBuildOutput(totalRoot, { maxTotalBytes: 15 }),
      new Error("Build output files must total no more than 15 bytes; found 16."),
    )
  })

  it("rejects non-ASCII output paths", async () => {
    const root = await buildRoot()
    await writeFile(path.join(root, "dist", "ſ.txt"), "ambiguous")

    await assert.rejects(
      validateBuildOutput(root),
      new Error(
        "Build output path must use printable ASCII names that work on Windows and Unix: ſ.txt",
      ),
    )
  })
})
