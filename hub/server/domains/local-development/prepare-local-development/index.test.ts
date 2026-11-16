import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { runCommand } from "../../../integrations/process/run-command"
import type { RunCommandOptions } from "../../../integrations/process/run-command/types"
import type { LocalDevelopmentConfiguration } from "../types"
import { prepareLocalDevelopment } from "."

const sourceRepositoryRoot = resolve("..")

function git(directory: string, ...arguments_: string[]): string {
  return execFileSync("git", ["-c", "maintenance.auto=false", "-C", directory, ...arguments_], {
    encoding: "utf8",
  }).trim()
}

function branchRefs(repository: string): Record<string, string> {
  const refs: Record<string, string> = {}
  for (const line of git(
    repository,
    "for-each-ref",
    "--format=%(refname:short) %(objectname)",
    "refs/heads",
  ).split("\n")) {
    const [name, revision] = line.split(" ")
    if (!name || !revision) throw new Error(`Invalid Git branch reference: ${line}`)
    refs[name] = revision
  }
  return refs
}

function expectSeedDependencyInstall(directory: string, prototypesRoot: string) {
  const local = relative(prototypesRoot, directory)
  expect(isAbsolute(local)).toBe(false)
  expect(local.startsWith("..")).toBe(false)
  expect(local.split("/").at(-1)).toBe("minimal")
}

function testConfiguration(): {
  configuration: LocalDevelopmentConfiguration & { enabled: true }
  npmDirectories: string[]
  runTestCommand: (options: RunCommandOptions) => Promise<void>
} {
  const root = resolve(
    `server/domains/local-development/prepare-local-development/.prepare-test-${randomUUID()}`,
  )
  const npmDirectories: string[] = []
  onTestFinished(() => rm(root, { force: true, recursive: true }))

  return {
    configuration: {
      buildActionDirectory: resolve(sourceRepositoryRoot, "actions/build"),
      createPrototypeScript: resolve(sourceRepositoryRoot, "scripts/create-prototype-repo.sh"),
      enabled: true,
      root,
      sourceRoot: sourceRepositoryRoot,
    },
    npmDirectories,
    runTestCommand: async (options) => {
      if (options.command === "npm" && options.arguments[0] === "ci") {
        npmDirectories.push(options.cwd)
        return
      }
      await runCommand(options)
    },
  }
}

describe("prepareLocalDevelopment()", () => {
  it("deterministically seeds Minimal with committed main and example branches", async () => {
    const first = testConfiguration()

    await prepareLocalDevelopment(first.configuration, { runCommand: first.runTestCommand })

    const minimal = resolve(first.configuration.root, "minimal")
    expect(Object.keys(branchRefs(minimal)).sort()).toEqual(["main", "prototype/example"])
    expect(git(minimal, "status", "--porcelain")).toBe("")
    expect(git(minimal, "rev-list", "--count", "main")).toBe("1")
    expect(git(minimal, "rev-list", "--count", "prototype/example")).toBe("2")
    expect(await readFile(resolve(minimal, "package.json"), "utf8")).toBe(
      await readFile(resolve(sourceRepositoryRoot, "starter/package.json"), "utf8"),
    )
    expect(first.npmDirectories[0]).toBe(first.configuration.buildActionDirectory)
    expectSeedDependencyInstall(first.npmDirectories[1]!, first.configuration.root)
    expect(first.npmDirectories).toHaveLength(2)

    const second = testConfiguration()
    await prepareLocalDevelopment(second.configuration, { runCommand: second.runTestCommand })
    expect(branchRefs(resolve(second.configuration.root, "minimal"))).toEqual(branchRefs(minimal))
  }, 15_000)

  it("does not seed or alter repositories when the configured root is non-empty", async () => {
    const fixture = testConfiguration()
    const existingRepository = resolve(fixture.configuration.root, "team-prototype")
    const marker = resolve(existingRepository, "owned.txt")
    await mkdir(existingRepository, { recursive: true })
    await writeFile(marker, "keep this repository\n")

    await prepareLocalDevelopment(fixture.configuration, { runCommand: fixture.runTestCommand })

    expect(await readFile(marker, "utf8")).toBe("keep this repository\n")
    await expect(
      readFile(resolve(fixture.configuration.root, "minimal/package.json"), "utf8"),
    ).rejects.toThrow()
    expect(fixture.npmDirectories).toEqual([fixture.configuration.buildActionDirectory])
  })

  it("preserves edited files, commits, and branches on later starts", async () => {
    const fixture = testConfiguration()
    await prepareLocalDevelopment(fixture.configuration, { runCommand: fixture.runTestCommand })
    const minimal = resolve(fixture.configuration.root, "minimal")
    git(minimal, "switch", "-c", "prototype/edited", "prototype/example")
    await writeFile(resolve(minimal, "local-edit.txt"), "keep my edit\n")
    git(minimal, "add", "local-edit.txt")
    git(
      minimal,
      "-c",
      "user.name=Local developer",
      "-c",
      "user.email=local@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "feat: keep local edit",
    )
    const refsBefore = branchRefs(minimal)

    await prepareLocalDevelopment(fixture.configuration, { runCommand: fixture.runTestCommand })

    expect(branchRefs(minimal)).toEqual(refsBefore)
    expect(git(minimal, "branch", "--show-current")).toBe("prototype/edited")
    expect(await readFile(resolve(minimal, "local-edit.txt"), "utf8")).toBe("keep my edit\n")
    expect(fixture.npmDirectories[0]).toBe(fixture.configuration.buildActionDirectory)
    expectSeedDependencyInstall(fixture.npmDirectories[1]!, fixture.configuration.root)
    expect(fixture.npmDirectories[2]).toBe(fixture.configuration.buildActionDirectory)
    expect(fixture.npmDirectories).toHaveLength(3)
  })
})
