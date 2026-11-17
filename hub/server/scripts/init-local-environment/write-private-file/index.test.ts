import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, onTestFinished } from "vitest"

import { writePrivateFile } from "./index.ts"

async function createDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "write-private-file-"))
  onTestFinished(() => rm(directory, { force: true, recursive: true }))
  return directory
}

describe("writePrivateFile", () => {
  it("replaces the file with owner-only content", async () => {
    const directory = await createDirectory()
    const path = join(directory, ".env")
    await writeFile(path, "OLD=1\n", { mode: 0o644 })

    await writePrivateFile(path, "NEW=1\n")

    expect(await readFile(path, "utf8")).toBe("NEW=1\n")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("does not follow a symbolic link at the temporary path", async () => {
    const directory = await createDirectory()
    const path = join(directory, ".env")
    const target = join(directory, "target")
    await writeFile(target, "unchanged")
    await symlink(target, `${path}.fixed.tmp`)

    await expect(writePrivateFile(path, "SECRET=1\n", { suffix: "fixed" })).rejects.toMatchObject({
      code: "EEXIST",
    })

    expect(await readFile(target, "utf8")).toBe("unchanged")
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
