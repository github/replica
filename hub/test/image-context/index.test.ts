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

  it("uses the configured npm registry only when the build argument is explicit", async () => {
    const [dockerfile, deploymentGuide] = await Promise.all([
      readFile(resolve("Dockerfile"), "utf8"),
      readFile(resolve("docs/deployment.md"), "utf8"),
    ])

    expect(dockerfile.match(/ARG NPM_REGISTRY\n/g)).toHaveLength(2)
    expect(dockerfile).not.toMatch(/ARG NPM_REGISTRY=\S+/)
    expect(dockerfile.match(/if \[ -n "\$NPM_REGISTRY" \]; then/g)).toHaveLength(2)
    expect(dockerfile.match(/delete entry\.resolved/g)).toHaveLength(2)
    expect(dockerfile.match(/export npm_config_registry="\$NPM_REGISTRY"/g)).toHaveLength(2)
    expect(dockerfile.match(/npm ci .*--include=optional/g)).toHaveLength(2)
    expect(dockerfile.match(/npm ci .*--fetch-retries=5 .*--prefer-offline/g)).toHaveLength(2)
    expect(dockerfile).not.toContain("NPM_FALLBACK_REGISTRY")
    expect(deploymentGuide).toContain("--build-arg NPM_REGISTRY=https://YOUR_PROXY/")
    expect(deploymentGuide).toContain(
      "Without `NPM_REGISTRY`, the container needs public npm access.",
    )
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
