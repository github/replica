import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"
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
        REPLICA_LEARNING_ROOT: "/private/learning",
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
    expect(result.environment).toMatchObject({
      COPILOT_GITHUB_TOKEN: "explicit-token",
      HOME: "/private/home",
      LANG: "en_US.UTF-8",
      LC_ALL: "C",
      REPLICA_LEARNING_ROOT: "/private/learning",
      TMPDIR: result.temporaryDirectory,
      TZ: "UTC",
    })
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

  it("kills the command process group when the timeout expires", async () => {
    const directory = resolve(`server/integrations/learning/.process-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { force: true, recursive: true }))
    const marker = resolve(directory, "child.pid")

    await expect(
      runLearningCommand(["copilot", "status"], {
        cliPath: resolve(fixtures, "hang-with-child.mjs"),
        environment: {
          PATH: process.env.PATH,
          REPLICA_LEARNING_PROCESS_MARKER: marker,
        },
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
      runLearningCommand(["copilot", "status"], {
        cliPath: resolve(fixtures, "exit-with-child.mjs"),
        environment: {
          PATH: process.env.PATH,
          REPLICA_LEARNING_PROCESS_MARKER: marker,
        },
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
