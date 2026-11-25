import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { inspect } from "node:util"
import { describe, expect, it, onTestFinished } from "vitest"

import { runLearningCommand } from "."
import { LearningCommandError } from "./errors"

const fixtures = resolve("test/fixtures/learning")

async function runPasswordFailure(databaseUrl: string, password: string, encodedPassword: string) {
  const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
  await mkdir(directory)
  onTestFinished(() => rm(directory, { force: true, recursive: true }))
  const cliPath = resolve(directory, "fail.mjs")
  await writeFile(
    cliPath,
    `
      const databaseUrl = process.env.REPLICA_LEARNING_DATABASE_URL
      const password = ${JSON.stringify(password)}
      const encodedPassword = ${JSON.stringify(encodedPassword)}
      process.stdout.write(JSON.stringify({
        considered: 3,
        receivedDatabaseUrl: Boolean(databaseUrl),
        nested: { databaseUrl, password, [password]: encodedPassword },
      }))
      process.stderr.write("error (learning_failed): Database failure: " + databaseUrl + " " + password + " " + encodedPassword)
      process.exitCode = 1
    `,
  )

  const error: unknown = await runLearningCommand(["label", "--dir", resolve(directory, "store")], {
    cliPath,
    learningDatabaseUrl: databaseUrl,
    environment: { PATH: process.env.PATH },
  }).catch((failure: unknown) => failure)
  if (!(error instanceof LearningCommandError)) throw new Error("Expected a command failure.")
  return error
}

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
        REPLICA_LEARNING_HUB_POSTGRES: "ambient-postgres-must-not-leak",
        REPLICA_LEARNING_HUB_REQUIRE_IMPORT: "ambient-import-must-not-leak",
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
      REPLICA_LEARNING_HUB_POSTGRES: "1",
    })
    expect(JSON.parse(result.config)).toMatchObject({
      memory: { provider: "postgres" },
      consolidation: {
        options: {
          signals: ["visual_quality", "accessibility", "usability", "content", "interaction"],
        },
      },
    })
    expect(JSON.parse(result.config)).not.toHaveProperty("memory.requireImport")
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

  it("preserves an existing SQLite config when opening Postgres", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const configPath = resolve(directory, "config.json")
    const config = `${JSON.stringify(
      {
        schemaVersion: "replica.learning-config/v1",
        memory: { provider: "sqlite" },
        consolidation: { options: { minPrototypes: 4, minReviewers: 3 } },
        labeling: { options: { model: "example-model", timeoutMs: 12000 } },
      },
      null,
      2,
    )}\n`
    await writeFile(configPath, config)
    const databaseUrl = "postgres://learning-user:learning-password@localhost/learning"
    const token = "explicit-token"

    const result = (await runLearningCommand(
      ["consolidate", "--dir", directory, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: databaseUrl,
        githubToken: token,
        environment: { PATH: process.env.PATH },
      },
    )) as {
      config: string
      environment: NodeJS.ProcessEnv
      temporaryDirectory: string
    }

    expect(result.config).toBe(config)
    expect(result.environment.REPLICA_LEARNING_HUB_POSTGRES).toBe("1")
    expect(result.environment.REPLICA_LEARNING_HUB_REQUIRE_IMPORT).toBe("1")
    expect(result.config).not.toContain(databaseUrl)
    expect(result.config).not.toContain(token)
    expect(await readFile(configPath, "utf8")).toBe(config)
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("uses Postgres-only config for a fresh store without requiring import", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const configPath = resolve(directory, "postgres-config.json")
    const config = `${JSON.stringify(
      {
        schemaVersion: "replica.learning-config/v1",
        consolidation: { options: { minPrototypes: 4 } },
        labeling: { options: { model: "example-model" } },
      },
      null,
      2,
    )}\n`
    await writeFile(configPath, config)
    const databaseUrl = "postgres://learning-user:learning-password@localhost/learning"
    const token = "explicit-token"

    const result = (await runLearningCommand(
      ["consolidate", "--dir", directory, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: databaseUrl,
        githubToken: token,
        environment: { PATH: process.env.PATH },
      },
    )) as {
      config: string
      environment: NodeJS.ProcessEnv
      temporaryDirectory: string
    }

    expect(result.config).toBe(config)
    expect(result.environment.REPLICA_LEARNING_HUB_POSTGRES).toBe("1")
    expect(result.environment.REPLICA_LEARNING_HUB_REQUIRE_IMPORT).toBeUndefined()
    expect(result.config).not.toContain(databaseUrl)
    expect(result.config).not.toContain(token)
    expect(await readFile(configPath, "utf8")).toBe(config)
    await expect(stat(result.temporaryDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects a store with both SQLite and Postgres configs", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const sqliteConfig = resolve(directory, "config.json")
    const postgresConfig = resolve(directory, "postgres-config.json")
    const marker = resolve(directory, "command.json")
    await writeFile(sqliteConfig, '{"memory":{"provider":"sqlite"}}\n')
    await writeFile(postgresConfig, '{"memory":{"provider":"postgres"}}\n')

    await expect(
      runLearningCommand(["consolidate", "--dir", directory, "--fixture-fail-report", marker], {
        cliPath: resolve(fixtures, "report-runtime.mjs"),
        learningDatabaseUrl: "postgres://learning-user:learning-password@localhost/learning",
        environment: { PATH: process.env.PATH },
      }),
    ).rejects.toBeInstanceOf(LearningCommandError)

    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" })
    expect(await readFile(sqliteConfig, "utf8")).toBe('{"memory":{"provider":"sqlite"}}\n')
    expect(await readFile(postgresConfig, "utf8")).toBe('{"memory":{"provider":"postgres"}}\n')
  })

  it("uses the preserved built-in config in the real learning command", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const configPath = resolve(directory, "config.json")
    const config = JSON.stringify({
      schemaVersion: "replica.learning-config/v1",
      memory: { provider: "sqlite" },
      consolidation: { consolidator: "none" },
      labeling: { options: { model: "example-model" } },
    })
    await writeFile(configPath, config)

    const error: unknown = await runLearningCommand(
      ["doctor", "--dir", directory, "--repository", "github.com/repositories/123"],
      {
        cliPath: resolve("../packages/learning/bin/replica-learning.mjs"),
        learningDatabaseUrl:
          "postgres://learning-user:learning-password@postgres.example.invalid/learning",
        environment: { PATH: process.env.PATH },
      },
    ).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(LearningCommandError)
    if (!(error instanceof LearningCommandError)) throw new Error("Expected a command failure.")
    expect(error.code).toBe("learning_failed")
    const result = error.result as { provider: { error: string }; consolidator: { source: string } }
    expect(result.provider.error).toContain("sslmode=verify-full")
    expect(result.consolidator.source).toBe("built-in none")
    expect(await readFile(configPath, "utf8")).toBe(config)
  })

  it("clearly rejects custom learning modules in the real command", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const configPath = resolve(directory, "postgres-config.json")

    for (const selection of [
      { consolidation: { consolidator: { module: "./custom.mjs" } } },
      { labeling: { labeler: { module: "./custom.mjs" } } },
    ]) {
      await writeFile(
        configPath,
        JSON.stringify({ schemaVersion: "replica.learning-config/v1", ...selection }),
      )
      const error: unknown = await runLearningCommand(
        ["doctor", "--dir", directory, "--repository", "github.com/repositories/123"],
        {
          cliPath: resolve("../packages/learning/bin/replica-learning.mjs"),
          learningDatabaseUrl: "postgres://learning-user:learning-password@localhost/learning",
          environment: { PATH: process.env.PATH },
        },
      ).catch((failure: unknown) => failure)

      expect(error).toBeInstanceOf(LearningCommandError)
      if (!(error instanceof LearningCommandError)) throw new Error("Expected a command failure.")
      expect(error.code).toBe("unsupported")
      expect(error.message).toMatch(/built-in.*only/)
    }
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

  it("does not pass the configured learning database URL to a command without a store", async () => {
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

  it("keeps the database URL and password out of command errors", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const cliPath = resolve(directory, "fail.mjs")
    await writeFile(
      cliPath,
      `
        const databaseUrl = process.env.REPLICA_LEARNING_DATABASE_URL
        const encodedPassword = new URL(databaseUrl).password
        const password = decodeURIComponent(encodedPassword)
        process.stdout.write(JSON.stringify({
          considered: 3,
          details: { databaseUrl, password, [password]: encodedPassword },
        }))
        process.stderr.write("error (learning_failed): Database connection failed: " + databaseUrl + " " + password + " " + encodedPassword)
        process.exitCode = 1
      `,
    )
    const password = "learning@password"
    const encodedPassword = "learning%40password"
    const databaseUrl = `postgres://learning-user:${encodedPassword}@localhost/learning`

    const error: unknown = await runLearningCommand(
      ["label", "--dir", resolve(directory, "store")],
      {
        cliPath,
        learningDatabaseUrl: databaseUrl,
        environment: { PATH: process.env.PATH },
      },
    ).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(LearningCommandError)
    if (!(error instanceof LearningCommandError)) throw new Error("Expected a command failure.")
    expect(error.code).toBe("learning_failed")
    expect(error.result).toMatchObject({ considered: 3 })
    const result = JSON.stringify(error.result) ?? ""
    for (const secret of [databaseUrl, password, encodedPassword]) {
      expect.soft(error.message).not.toContain(secret)
      expect.soft(result).not.toContain(secret)
    }
  })

  it("hides query parameter passwords in command errors and progress", async () => {
    const password = "query@password"
    const encodedPassword = "query%40password"
    const databaseUrl = `postgres://learning-user@localhost/learning?password=${encodedPassword}`

    const error = await runPasswordFailure(databaseUrl, password, encodedPassword)

    expect(error).toMatchObject({
      code: "learning_failed",
      result: { considered: 3, receivedDatabaseUrl: true },
    })
    const result = JSON.stringify(error.result) ?? ""
    for (const secret of [databaseUrl, password, encodedPassword]) {
      expect.soft(error.message).not.toContain(secret)
      expect.soft(result).not.toContain(secret)
    }
  })

  it("hides Unix-socket URL passwords in command errors and progress", async () => {
    const password = "socket@password"
    const encodedPassword = "socket%40password"
    const databaseUrl = `postgresql://learning-user:${encodedPassword}@/learning?host=%2Fvar%2Frun%2Fpostgresql`

    const error = await runPasswordFailure(databaseUrl, password, encodedPassword)

    expect(error).toMatchObject({
      code: "learning_failed",
      result: { considered: 3, receivedDatabaseUrl: true },
    })
    const result = JSON.stringify(error.result) ?? ""
    for (const secret of [databaseUrl, password, encodedPassword]) {
      expect.soft(error.message).not.toContain(secret)
      expect.soft(result).not.toContain(secret)
    }
  })

  it("does not expose malformed successful output through the error or its cause", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const cliPath = resolve(directory, "malformed.mjs")
    await writeFile(
      cliPath,
      `
        const databaseUrl = process.env.REPLICA_LEARNING_DATABASE_URL
        process.stdout.write(new URL(databaseUrl).password)
      `,
    )
    const password = "parseSecret"
    const databaseUrl = `postgres://learning-user:${password}@localhost/learning`

    const error: unknown = await runLearningCommand(
      ["label", "--dir", resolve(directory, "store")],
      {
        cliPath,
        learningDatabaseUrl: databaseUrl,
        environment: { PATH: process.env.PATH },
      },
    ).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(LearningCommandError)
    if (!(error instanceof LearningCommandError)) throw new Error("Expected a command failure.")
    expect(error.code).toBe("unreadable_output")
    const diagnostic = inspect(error, { depth: null })
    for (const secret of [databaseUrl, password]) {
      expect.soft(diagnostic).not.toContain(secret)
    }
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
