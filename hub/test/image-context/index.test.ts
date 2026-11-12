import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

function isIgnored(directory: string, path: string) {
  return (
    spawnSync("git", ["-C", directory, "check-ignore", "--no-index", "--quiet", "--", path], {
      stdio: "ignore",
    }).status === 0
  )
}

describe("Hub image context", () => {
  it("excludes mutable learning and Hub storage without excluding build inputs", async () => {
    const directory = resolve(`test/image-context/.context-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    execFileSync("git", ["init", "--quiet", directory])
    await writeFile(
      resolve(directory, ".gitignore"),
      await readFile(resolve("Dockerfile.dockerignore"), "utf8"),
    )

    expect(isIgnored(directory, "hub/storage/learning/repository.sqlite")).toBe(true)
    expect(isIgnored(directory, "packages/learning/.test-work/run/output.json")).toBe(true)
    expect(isIgnored(directory, "hub/package.json")).toBe(false)
    expect(isIgnored(directory, "packages/learning/src/index.ts")).toBe(false)
  })

  it("ignores both the source learning store and future hosted stores", async () => {
    const directory = resolve(`test/image-context/.ignore-test-${randomUUID()}`)
    await mkdir(resolve(directory, "hub"), { recursive: true })
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    execFileSync("git", ["init", "--quiet", directory])
    await writeFile(
      resolve(directory, "hub/.gitignore"),
      await readFile(resolve(".gitignore"), "utf8"),
    )

    expect(isIgnored(directory, "hub/storage/learning/repository.sqlite")).toBe(true)
    expect(isIgnored(directory, "hub/storage/hosted/repository.sqlite")).toBe(true)
  })
})
