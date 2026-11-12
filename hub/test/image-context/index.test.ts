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
  it("allowlists learning runtime inputs without including private stores", async () => {
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
    expect(isIgnored(directory, "packages/learning/private-store/repository.sqlite")).toBe(true)
    expect(isIgnored(directory, "hub/package.json")).toBe(false)
    for (const path of [
      "packages/learning/package.json",
      "packages/learning/package-lock.json",
      "packages/learning/bin/replica-learning.mjs",
      "packages/learning/src/cli.mjs",
    ]) {
      expect(isIgnored(directory, path), path).toBe(false)
    }
  })

  it("uses an alternate npm registry only when the build argument is explicit", async () => {
    const [dockerfile, deploymentGuide] = await Promise.all([
      readFile(resolve("Dockerfile"), "utf8"),
      readFile(resolve("docs/deployment.md"), "utf8"),
    ])

    expect(dockerfile).toContain("ARG NPM_FALLBACK_REGISTRY\n")
    expect(dockerfile).not.toMatch(/ARG NPM_FALLBACK_REGISTRY=\S+/)
    const fallbackInstalls = [...dockerfile.matchAll(/--registry="\$\{NPM_FALLBACK_REGISTRY\}"/g)]
    expect(fallbackInstalls.length).toBeGreaterThan(0)
    for (const install of fallbackInstalls) {
      expect(dockerfile.slice(Math.max(0, install.index - 180), install.index)).toContain(
        'test -n "${NPM_FALLBACK_REGISTRY}"',
      )
    }
    expect(deploymentGuide).toContain(
      "--build-arg NPM_FALLBACK_REGISTRY=https://another.example/npm/",
    )
    expect(deploymentGuide).toContain("does not contact an alternate registry")
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
