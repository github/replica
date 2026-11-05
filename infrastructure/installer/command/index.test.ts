import path from "node:path"
import { inspect } from "node:util"
import { describe, expect, it, vi } from "vitest"

import { runCommand } from "./index.ts"

describe("installer command execution", () => {
  it("passes shell metacharacters literally and captures stdout", async () => {
    const args = ["$(printf injected)", "; printf injected", "*.json", "a b", '"quoted"']
    const output = await runCommand(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      "--",
      ...args,
    ])

    expect(JSON.parse(output)).toEqual(args)
  })

  it("uses the supplied working directory and environment without dropping inherited variables", async () => {
    vi.stubEnv("REPLICA_COMMAND_INHERITED_TEST", "inherited-value")
    const cwd = path.resolve("installer")
    const output = await runCommand(
      process.execPath,
      [
        "-e",
        `process.stdout.write(JSON.stringify({
          cwd: process.cwd(),
          inherited: process.env.REPLICA_COMMAND_INHERITED_TEST,
          supplied: process.env.REPLICA_COMMAND_SUPPLIED_TEST
        }))`,
      ],
      { cwd, env: { REPLICA_COMMAND_SUPPLIED_TEST: "supplied-value" } },
    )

    expect(JSON.parse(output)).toEqual({
      cwd,
      inherited: "inherited-value",
      supplied: "supplied-value",
    })
  })

  it("names the failed operation and exit status without exposing subprocess secrets", async () => {
    const label = "Discover selected subscription regions"
    const secrets = [
      "synthetic-argument-secret",
      "synthetic-stdout-secret",
      "synthetic-stderr-secret",
      "synthetic-environment-secret",
    ]
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    let failure: unknown
    let emitted = ""
    try {
      await runCommand(
        process.execPath,
        [
          "-e",
          `process.stdout.write(${JSON.stringify(secrets[1])});
           process.stderr.write(${JSON.stringify(secrets[2])});
           process.exit(7)`,
          "--",
          secrets[0]!,
        ],
        { label, env: { REPLICA_COMMAND_SECRET_TEST: secrets[3] } },
      )
    } catch (error) {
      failure = error
    } finally {
      emitted = inspect([stderr.mock.calls, stdout.mock.calls])
      stderr.mockRestore()
      stdout.mockRestore()
    }

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(label)
    expect((failure as Error).message).toMatch(/\bexit(?:ed with)?(?: code| status)?[: ]+7\b/i)
    const visibleFailure = inspect(failure, { depth: 10, showHidden: true })
    for (const secret of secrets) {
      expect(visibleFailure).not.toContain(secret)
      expect(emitted).not.toContain(secret)
    }
  })

  it("redacts arguments when the executable cannot be started", async () => {
    const secret = "synthetic-startup-argument-secret"
    let failure: unknown
    try {
      await runCommand(path.resolve("installer/nonexistent-executable"), [secret])
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(inspect(failure, { depth: 10, showHidden: true })).not.toContain(secret)
  })
})
