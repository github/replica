import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { runLearningCommand } from "."

const fixtures = resolve("test/fixtures/learning")

describe("runLearningCommand()", () => {
  it("isolates the environment in a private temporary directory and removes it afterward", async () => {
    const result = (await runLearningCommand(["copilot", "status"], {
      cliPath: resolve(fixtures, "report-runtime.mjs"),
      githubToken: "explicit-token",
      environment: {
        COPILOT_GITHUB_TOKEN: "ambient-token-must-not-leak",
        HOME: "/private/home",
        LANG: "en_US.UTF-8",
        LC_ALL: "C",
        PATH: process.env.PATH,
        REPLICA_LEARNING_DATABASE_URL: "ambient-database-url-must-not-leak",
        REPLICA_LEARNING_MIGRATION_DATABASE_URL: "migration-url-must-not-leak",
        REPLICA_LEARNING_ROOT: "/private/learning",
        REPLICA_LEARNING_SECRET: "must-not-leak",
        SECRET_FROM_HUB: "must-not-leak",
        TZ: "UTC",
      },
    })) as {
      arguments: string[]
      environment: NodeJS.ProcessEnv
      temporaryDirectory: string
      temporaryDirectoryMode: number
    }

    expect(result.arguments).toEqual(["copilot", "status", "--json"])
    expect(result.environment).toEqual({
      COPILOT_GITHUB_TOKEN: "explicit-token",
      HOME: "/private/home",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      PATH: process.env.PATH,
      TMPDIR: result.temporaryDirectory,
      TZ: "UTC",
    })
    expect(result.environment.REPLICA_LEARNING_ROOT).toBeUndefined()
    expect(result.environment.REPLICA_LEARNING_SECRET).toBeUndefined()
    expect(result.environment.SECRET_FROM_HUB).toBeUndefined()
    expect(result.temporaryDirectoryMode).toBe(0o700)
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("does not pass an ambient GitHub token when no credential was explicitly acquired", async () => {
    const result = (await runLearningCommand(["copilot", "status"], {
      cliPath: resolve(fixtures, "report-runtime.mjs"),
      environment: {
        COPILOT_GITHUB_TOKEN: "ambient-token-must-not-leak",
        PATH: process.env.PATH,
      },
    })) as { environment: NodeJS.ProcessEnv }

    expect(result.environment.COPILOT_GITHUB_TOKEN).toBeUndefined()
  })

  it("uses a private Postgres config and passes only explicitly supplied credentials", async () => {
    const databaseUrl = "postgres://learning-user:learning-password@localhost/learning"
    const nonexistentDirectory = resolve(
      `server/integrations/learning/.process-test-${randomUUID()}`,
    )
    const result = (await runLearningCommand(
      ["consolidate", "--dir", nonexistentDirectory, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: databaseUrl,
        githubToken: "explicit-token",
        environment: {
          PATH: process.env.PATH,
          COPILOT_GITHUB_TOKEN: "ambient-token-must-not-leak",
          REPLICA_LEARNING_DATABASE_URL: "ambient-url-must-not-leak",
          REPLICA_LEARNING_MIGRATION_DATABASE_URL: "migration-url-must-not-leak",
          DATABASE_URL: "hub-database-url-must-not-leak",
          SECRET_FROM_HUB: "hub-secret-must-not-leak",
        },
      },
    )) as {
      arguments: string[]
      config: string
      environment: NodeJS.ProcessEnv
      temporaryDirectory: string
      temporaryDirectoryMode: number
    }

    const storeDirectory = result.arguments[2]
    if (storeDirectory === undefined) throw new Error("Missing store directory argument.")
    const relativeStore = relative(result.temporaryDirectory, storeDirectory)
    expect(isAbsolute(storeDirectory)).toBe(true)
    expect(isAbsolute(relativeStore)).toBe(false)
    expect(relativeStore === ".." || relativeStore.startsWith(`..${sep}`)).toBe(false)
    expect(result.arguments).toEqual([
      "consolidate",
      "--dir",
      storeDirectory,
      "--repository",
      "github.com/repositories/123",
      "--json",
    ])
    expect(result.environment).toEqual({
      PATH: process.env.PATH,
      TMPDIR: result.temporaryDirectory,
      COPILOT_GITHUB_TOKEN: "explicit-token",
      REPLICA_LEARNING_DATABASE_URL: databaseUrl,
    })
    expect(JSON.parse(result.config)).toMatchObject({
      memory: { provider: "postgres" },
      consolidation: {
        options: {
          signals: ["visual_quality", "accessibility", "usability", "content", "interaction"],
        },
      },
    })
    expect(JSON.parse(result.config).memory.requireImport).toBeUndefined()
    for (const secret of [
      databaseUrl,
      "learning-password",
      "explicit-token",
      "migration-url-must-not-leak",
      "hub-secret-must-not-leak",
    ]) {
      expect(result.config).not.toContain(secret)
      expect(result.arguments.join(" ")).not.toContain(secret)
    }
    expect(result.temporaryDirectoryMode).toBe(0o700)
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("requires import when the original store directory is nonempty", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const history = resolve(directory, "history.sqlite")
    await writeFile(history, "existing learning history")

    const result = (await runLearningCommand(
      ["consolidate", "--dir", directory, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: "postgres://learning-user:learning-password@localhost/learning",
        environment: { PATH: process.env.PATH },
      },
    )) as { arguments: string[]; config: string; temporaryDirectory: string }

    const storeDirectory = result.arguments[2]
    if (storeDirectory === undefined) throw new Error("Missing store directory argument.")
    const relativeStore = relative(result.temporaryDirectory, storeDirectory)
    expect(isAbsolute(storeDirectory)).toBe(true)
    expect(isAbsolute(relativeStore)).toBe(false)
    expect(relativeStore === ".." || relativeStore.startsWith(`..${sep}`)).toBe(false)
    expect(result.arguments).toEqual([
      "consolidate",
      "--dir",
      storeDirectory,
      "--repository",
      "github.com/repositories/123",
      "--json",
    ])
    expect(JSON.parse(result.config)).toMatchObject({
      memory: { provider: "postgres", requireImport: true },
    })
    expect(await readFile(history, "utf8")).toBe("existing learning history")
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("requires import for a nonempty store supplied with an equals sign", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    await writeFile(resolve(directory, "history.sqlite"), "existing learning history")

    const result = (await runLearningCommand(
      ["consolidate", `--dir=${directory}`, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: "postgres://learning-user:learning-password@localhost/learning",
        environment: { PATH: process.env.PATH },
      },
    )) as { arguments: string[]; config: string; temporaryDirectory: string }

    const directoryArgument = result.arguments[1]
    if (directoryArgument === undefined) throw new Error("Missing store directory argument.")
    const storeDirectory = directoryArgument.slice("--dir=".length)
    const relativeStore = relative(result.temporaryDirectory, storeDirectory)
    expect(isAbsolute(storeDirectory)).toBe(true)
    expect(isAbsolute(relativeStore)).toBe(false)
    expect(relativeStore === ".." || relativeStore.startsWith(`..${sep}`)).toBe(false)
    expect(result.arguments).toEqual([
      "consolidate",
      `--dir=${storeDirectory}`,
      "--repository",
      "github.com/repositories/123",
      "--json",
    ])
    expect(JSON.parse(result.config)).toMatchObject({
      memory: { provider: "postgres", requireImport: true },
    })
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("passes an explicitly supplied learning database URL to a command without a store", async () => {
    const databaseUrl = "postgres://learning-user:learning-password@localhost/learning"
    const result = (await runLearningCommand(["copilot", "status"], {
      cliPath: resolve(fixtures, "report-runtime.mjs"),
      learningDatabaseUrl: databaseUrl,
      environment: {
        PATH: process.env.PATH,
        COPILOT_GITHUB_TOKEN: "ambient-token-must-not-leak",
        REPLICA_LEARNING_MIGRATION_DATABASE_URL: "migration-url-must-not-leak",
      },
    })) as { arguments: string[]; environment: NodeJS.ProcessEnv; temporaryDirectory: string }

    expect(result.arguments).toEqual(["copilot", "status", "--json"])
    expect(result.environment).toEqual({
      PATH: process.env.PATH,
      TMPDIR: result.temporaryDirectory,
      REPLICA_LEARNING_DATABASE_URL: databaseUrl,
    })
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("retains the original store directory without an explicit learning database URL", async () => {
    const result = (await runLearningCommand(
      ["consolidate", "--dir", "/existing/sqlite", "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        environment: { PATH: process.env.PATH, REPLICA_LEARNING_DATABASE_URL: "ambient-url" },
      },
    )) as { arguments: string[]; environment: NodeJS.ProcessEnv }

    expect(result.arguments).toEqual([
      "consolidate",
      "--dir",
      "/existing/sqlite",
      "--repository",
      "github.com/repositories/123",
      "--json",
    ])
    expect(result.environment.REPLICA_LEARNING_DATABASE_URL).toBeUndefined()
  })

  it("removes the private Postgres config after a failed command", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const marker = resolve(directory, "command.json")

    await expect(
      runLearningCommand(
        ["consolidate", "--dir", "/existing/sqlite", "--fixture-fail-report", marker],
        {
          cliPath: resolve(fixtures, "report-runtime.mjs"),
          learningDatabaseUrl: "postgres://learning-user:learning-password@localhost/learning",
          environment: { PATH: process.env.PATH },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" })

    const result = JSON.parse(await readFile(marker, "utf8")) as {
      arguments: string[]
      config: string
      temporaryDirectory: string
    }
    const storeDirectory = result.arguments[2]
    if (storeDirectory === undefined) throw new Error("Missing store directory argument.")
    const relativeStore = relative(result.temporaryDirectory, storeDirectory)
    expect(isAbsolute(storeDirectory)).toBe(true)
    expect(isAbsolute(relativeStore)).toBe(false)
    expect(relativeStore === ".." || relativeStore.startsWith(`..${sep}`)).toBe(false)
    expect(JSON.parse(result.config)).toMatchObject({ memory: { provider: "postgres" } })
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("preserves valid JSON progress from a failed command", async () => {
    await expect(
      runLearningCommand(["label"], {
        cliPath: resolve(fixtures, "fail-with-json.mjs"),
        environment: { PATH: process.env.PATH },
      }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      result: {
        considered: 3,
        labeled: 2,
        remaining: 1,
        usage: { requests: 2, nanoAiu: 1_250_000 },
      },
    })
  })

  it.each([
    ["stdout", "outputLimit"],
    ["stderr", "errorLimit"],
  ] as const)(
    "stops the process and cleans temporary state when %s exceeds its cap",
    async (channel, limit) => {
      const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
      await mkdir(directory)
      onTestFinished(() => rm(directory, { force: true, recursive: true }))
      const marker = resolve(directory, "command.json")

      await expect(
        runLearningCommand([marker, channel], {
          cliPath: resolve(fixtures, "exceed-output-limit.mjs"),
          environment: { PATH: process.env.PATH },
          [limit]: 64,
        }),
      ).rejects.toMatchObject({ code: "output_too_large" })

      const processState = JSON.parse(await readFile(marker, "utf8")) as {
        commandPid: number
        temporaryDirectory: string
      }
      expect(() => process.kill(processState.commandPid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      )
      await expect(stat(processState.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it("kills the command process group when the timeout expires", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const marker = resolve(directory, "child.pid")

    await expect(
      runLearningCommand([marker], {
        cliPath: resolve(fixtures, "hang-with-child.mjs"),
        environment: { PATH: process.env.PATH },
        timeoutMs: 250,
      }),
    ).rejects.toMatchObject({ code: "timeout" })

    const processes = JSON.parse(await readFile(marker, "utf8")) as {
      childPid: number
      commandPid: number
    }
    for (const pid of [processes.commandPid, processes.childPid]) {
      let exists = true
      try {
        process.kill(pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        exists = false
      }
      expect(exists).toBe(false)
    }
  })

  it("stops a surviving descendant after the command exits normally", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    const marker = resolve(directory, "child.pid")
    onTestFinished(async () => {
      try {
        const childPid = Number(await readFile(marker, "utf8"))
        try {
          process.kill(childPid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    })

    await expect(
      runLearningCommand([marker], {
        cliPath: resolve(fixtures, "exit-with-child.mjs"),
        environment: { PATH: process.env.PATH },
      }),
    ).resolves.toEqual({ complete: true })

    const childPid = Number(await readFile(marker, "utf8"))
    let exists = true
    try {
      process.kill(childPid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      exists = false
    }
    expect(exists).toBe(false)
  })
})
