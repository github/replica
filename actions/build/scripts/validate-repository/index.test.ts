import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { validateRepository } from "./index.ts"

describe("validateRepository()", () => {
  it("accepts the required root npm files and build command", async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    )
    await writeFile(path.join(root, "package-lock.json"), "{}")

    await expect(validateRepository(root)).resolves.toBeUndefined()
  })

  it("requires both root files", async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    )

    await expect(validateRepository(root)).rejects.toThrow(
      new Error("Repository must contain package-lock.json at its root."),
    )

    await mkdir(path.join(root, "package-lock.json"))
    await expect(validateRepository(root)).rejects.toThrow(
      new Error(
        "Repository package-lock.json must be a file. Symbolic links and directories are not allowed.",
      ),
    )
  })

  it("requires a non-empty build script", async () => {
    const root = await temporaryDirectory()
    await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "  " } }))
    await writeFile(path.join(root, "package-lock.json"), "{}")

    await expect(validateRepository(root)).rejects.toThrow(
      new Error("Repository package.json must contain a non-empty scripts.build command."),
    )
  })
})
