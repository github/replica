import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"

import { createBuildSnapshot } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("fingerprints copied build contents while excluding ignored files and retaining re-included examples", async () => {
  const root = await mkdtemp(join(import.meta.dirname, ".build-context-test-"))
  directories.push(root)
  const source = join(root, "source")
  const parent = join(root, "snapshots")
  await mkdir(join(source, "node_modules"), { recursive: true })
  await mkdir(join(source, "server"), { recursive: true })
  await mkdir(parent)
  await writeFile(
    join(source, ".dockerignore"),
    ".env*\n!.env.example\nnode_modules\n**/*.test.*\n",
  )
  await writeFile(join(source, "Dockerfile"), "FROM scratch\n")
  await writeFile(join(source, ".env"), "synthetic-secret\n")
  await writeFile(join(source, ".env.example"), "DOCUMENTED=value\n")
  await writeFile(join(source, "node_modules", "dependency.js"), "ignored dependency\n")
  await writeFile(join(source, "server", "feature.test.ts"), "ignored test\n")
  await writeFile(join(source, "server", "feature.ts"), "included source\n")

  const first = await createBuildSnapshot(source, parent)
  try {
    await expect(readFile(join(first.directory, ".env"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(join(first.directory, "node_modules", "dependency.js"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(join(first.directory, "server", "feature.test.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(join(first.directory, ".env.example"), "utf8")).resolves.toBe(
      "DOCUMENTED=value\n",
    )
    await writeFile(join(source, ".env"), "changed synthetic secret\n")
    await writeFile(join(source, "server", "feature.test.ts"), "changed ignored test\n")
  } finally {
    await first.cleanup()
  }

  const unchanged = await createBuildSnapshot(source, parent)
  try {
    expect(unchanged.fingerprint).toBe(first.fingerprint)
  } finally {
    await unchanged.cleanup()
  }

  await writeFile(join(source, "server", "feature.ts"), "changed included source\n")
  const changed = await createBuildSnapshot(source, parent)
  try {
    expect(changed.fingerprint).not.toBe(first.fingerprint)
    await expect(readFile(join(changed.directory, "server", "feature.ts"), "utf8")).resolves.toBe(
      "changed included source\n",
    )
  } finally {
    await changed.cleanup()
  }
})
