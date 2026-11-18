import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { runLocalReplicaBuild } from "."

const execute = promisify(execFile)

describe("runLocalReplicaBuild()", () => {
  it("runs the shared action stages against only the requested committed checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "replica-local-runner-test-"))
    onTestFinished(() => rm(root, { force: true, recursive: true }))
    const repository = path.join(root, "prototype")
    const actionRoot = path.join(root, "action")
    const scripts = path.join(actionRoot, "scripts")
    const bin = path.join(root, "bin")
    await mkdir(repository)
    await mkdir(bin)
    for (const name of [
      "validate-repository",
      "validate-build-output",
      "capture-screenshots",
      "create-package",
    ]) {
      await mkdir(path.join(scripts, name), { recursive: true })
    }
    await writeFile(path.join(repository, "source.txt"), "committed")
    await execute("git", ["init", "-b", "main"], { cwd: repository })
    await execute("git", ["config", "user.name", "Local Builder"], { cwd: repository })
    await execute("git", ["config", "user.email", "builder@example.com"], { cwd: repository })
    await execute("git", ["add", "source.txt"], { cwd: repository })
    await execute("git", ["commit", "-m", "Add source"], { cwd: repository })
    const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: repository })
    await writeFile(path.join(repository, "source.txt"), "uncommitted")
    await writeFile(path.join(repository, "untracked.txt"), "must not build")

    await writeFile(
      path.join(scripts, "validate-repository/index.mjs"),
      `import { access } from "node:fs/promises"
const root = process.argv[process.argv.indexOf("--root") + 1]
await access(root + "/source.txt")
`,
    )
    await writeFile(
      path.join(scripts, "validate-build-output/index.mjs"),
      `import { access } from "node:fs/promises"
const root = process.argv[process.argv.indexOf("--root") + 1]
await access(root + "/dist/index.html")
`,
    )
    await writeFile(
      path.join(scripts, "capture-screenshots/index.mjs"),
      `import { mkdir, writeFile } from "node:fs/promises"
const output = process.argv[process.argv.indexOf("--screenshots") + 1]
await mkdir(output, { recursive: true })
await writeFile(output + "/desktop.png", "screenshot")
`,
    )
    await writeFile(
      path.join(scripts, "create-package/index.mjs"),
      `import { cp, mkdir } from "node:fs/promises"
const root = process.argv[process.argv.indexOf("--root") + 1]
const screenshots = process.argv[process.argv.indexOf("--screenshots") + 1]
const output = process.argv[process.argv.indexOf("--output") + 1]
await mkdir(output, { recursive: true })
await cp(root + "/dist", output + "/dist", { recursive: true })
await cp(screenshots, output + "/screenshots", { recursive: true })
`,
    )
    const fakeDocker = path.join(bin, "docker")
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
if (process.argv[2] === "rm") process.exit(0)
if (process.env.HANG_BUILD === "true") {
  setInterval(() => {}, 1_000)
  await new Promise(() => {})
}
const mount = process.argv[process.argv.indexOf("--mount") + 1]
const source = mount.slice("type=bind,source=".length, mount.indexOf(",target="))
if (!process.argv.includes("npm_config_registry=https://packagefeedproxy.microsoft.io/npm/")) {
  process.exit(3)
}
if (!process.argv.includes("--memory=2g") || !process.argv.includes("--cpus=2")) process.exit(4)
try {
  await access(source + "/untracked.txt")
  process.exit(2)
} catch {}
const content = await readFile(source + "/source.txt", "utf8")
await mkdir(source + "/dist")
await writeFile(source + "/dist/index.html", content)
`,
      { mode: 0o755 },
    )
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
    vi.stubEnv("npm_config_registry", "https://packagefeedproxy.microsoft.io/npm/")

    const result = await runLocalReplicaBuild({
      repositoryPath: repository,
      commitSha: stdout.trim(),
      actionRoot,
      temporaryRoot: root,
      executionTimeoutMs: 60_000,
    })
    onTestFinished(() => result.cleanup())

    await expect(
      readFile(path.join(result.packageDirectory, "dist/index.html"), "utf8"),
    ).resolves.toBe("committed")
    await expect(
      access(path.join(result.packageDirectory, "screenshots/desktop.png")),
    ).resolves.toBe(undefined)
    await result.cleanup()

    vi.stubEnv("HANG_BUILD", "true")
    await expect(
      runLocalReplicaBuild({
        repositoryPath: repository,
        commitSha: stdout.trim(),
        actionRoot,
        temporaryRoot: root,
        executionTimeoutMs: 50,
      }),
    ).rejects.toThrow("Prototype build exceeded 1 minutes.")
  })
})
