import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve } from "node:path"
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
  expect(basename(directory)).toBe("minimal")
}

function testConfiguration(): {
  configuration: LocalDevelopmentConfiguration & { enabled: true }
  browserDirectories: string[]
  npmDirectories: string[]
  runTestCommand: (options: RunCommandOptions) => Promise<void>
} {
  const root = resolve(`.prepare-test-${randomUUID()}`)
  const browserDirectories: string[] = []
  const npmDirectories: string[] = []
  onTestFinished(() => rm(root, { force: true, recursive: true }))

  return {
    browserDirectories,
    configuration: {
      buildActionDirectory: resolve(root, ".build-action"),
      createPrototypeScript: resolve(sourceRepositoryRoot, "scripts/create-prototype-repo.mjs"),
      enabled: true,
      root,
      sourceRoot: sourceRepositoryRoot,
      temporaryRoot: resolve(root, ".temporary"),
    },
    npmDirectories,
    runTestCommand: async (options) => {
      if (
        (options.command === "npm" && options.arguments[0] === "ci") ||
        (options.command === process.execPath && options.arguments[1] === "ci")
      ) {
        npmDirectories.push(options.cwd)
        return
      }
      if (
        options.command === process.execPath &&
        options.arguments.join(" ") === "node_modules/playwright/cli.js install chromium"
      ) {
        browserDirectories.push(options.cwd)
        return
      }
      await runCommand(options)
    },
  }
}

describe("prepareLocalDevelopment()", () => {
  it.runIf(process.platform === "win32")(
    "runs both npm installs through Node with a literal entrypoint containing spaces and shell characters",
    async () => {
      const fixture = testConfiguration()
      const tools = `${fixture.configuration.root}-npm tools & spaces`
      onTestFinished(() => rm(tools, { force: true, recursive: true }))
      const entrypoint = resolve(tools, "npm-cli.js")
      const log = resolve(tools, "arguments.jsonl")
      fixture.configuration.buildActionDirectory = resolve(tools, "build-action")
      await mkdir(fixture.configuration.buildActionDirectory, { recursive: true })
      await writeFile(
        entrypoint,
        `import { appendFileSync } from "node:fs"
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n")
`,
      )
      vi.stubEnv("npm_execpath", entrypoint)

      await prepareLocalDevelopment(fixture.configuration, {
        runCommand: (options) =>
          options.arguments[0] === entrypoint
            ? runCommand(options)
            : fixture.runTestCommand(options),
      })

      expect(
        (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as unknown),
      ).toEqual([
        ["ci", "--ignore-scripts", "--omit=dev", "--engine-strict"],
        ["ci", "--engine-strict"],
      ])
      expect(
        Object.keys(branchRefs(resolve(fixture.configuration.root, "minimal"))).sort(),
      ).toEqual(["main", "prototype/example"])
    },
  )

  it("reports the Starter creation stage safely when the Node scaffold fails", async () => {
    const fixture = testConfiguration()

    await expect(
      prepareLocalDevelopment(fixture.configuration, {
        runCommand: async (options) => {
          if (options.arguments[0] === fixture.configuration.createPrototypeScript) {
            throw new Error("private subprocess diagnostics")
          }
          await fixture.runTestCommand(options)
        },
      }),
    ).rejects.toThrow(
      "Could not create the Starter repository. Check the local preparation prerequisites and try again.",
    )
  })

  it("deterministically seeds Minimal with committed main and example branches", async () => {
    vi.stubEnv("npm_execpath", undefined)
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
    expect(first.browserDirectories).toEqual([first.configuration.buildActionDirectory])

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
    expect(fixture.browserDirectories).toEqual([fixture.configuration.buildActionDirectory])
  })

  it("reports a safe preparation stage without subprocess output", async () => {
    const fixture = testConfiguration()
    const runCommand = vi
      .fn()
      .mockRejectedValue(new Error("npm failed: https://token@example.com/private-package"))

    await expect(prepareLocalDevelopment(fixture.configuration, { runCommand })).rejects.toThrow(
      "Could not install dependencies. Check the local preparation prerequisites and try again.",
    )
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
    expect(fixture.browserDirectories).toEqual([
      fixture.configuration.buildActionDirectory,
      fixture.configuration.buildActionDirectory,
    ])
  })
})
