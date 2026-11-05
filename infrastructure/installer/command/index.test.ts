import path from "node:path"
import { inspect } from "node:util"
import { describe, expect, it, vi } from "vitest"

import { CommandExecutionError, runCommand } from "./index.ts"

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

  it("keeps failed stderr in the local error without printing output or exposing argv, stdout, or environment", async () => {
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

    expect(failure).toBeInstanceOf(CommandExecutionError)
    expect((failure as Error).message).toContain(label)
    expect((failure as Error).message).toMatch(/\bexit(?:ed with)?(?: code| status)?[: ]+7\b/i)
    expect((failure as CommandExecutionError).exitCode).toBe(7)
    expect((failure as Error).message).toContain(secrets[2])
    const visibleFailure = inspect(failure, { depth: 10, showHidden: true })
    for (const secret of [secrets[0], secrets[1], secrets[3]]) {
      expect(visibleFailure).not.toContain(secret)
    }
    for (const secret of secrets) {
      expect(emitted).not.toContain(secret)
    }
  })

  it("returns successful stdout without printing stdout or stderr", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    let output: string
    let emitted: string
    try {
      output = await runCommand(process.execPath, [
        "-e",
        `process.stdout.write("synthetic-success-stdout");
         process.stderr.write("synthetic-success-stderr")`,
      ])
      emitted = inspect([stdout.mock.calls, stderr.mock.calls])
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
    }

    expect(output).toBe("synthetic-success-stdout")
    expect(emitted).not.toContain("synthetic-success-stdout")
    expect(emitted).not.toContain("synthetic-success-stderr")
  })

  it("reports the operation and exit code when a failed command has no stderr", async () => {
    const label = "Check local prerequisite"
    const failure = await runCommand(process.execPath, ["-e", "process.exit(3)"], { label }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(CommandExecutionError)
    expect((failure as CommandExecutionError).exitCode).toBe(3)
    expect((failure as Error).message).toContain(label)
    expect((failure as Error).message).toMatch(/\bexit(?:ed with)?(?: code| status)?[: ]+3\b/i)
    expect((failure as Error).message).not.toMatch(/\bundefined\b|\bnull\b/)
  })

  it("removes terminal escapes and control characters from failed stderr", async () => {
    const diagnostic = "\u001b[31mpermission denied\u001b[0m\u0000\u0007\u001b]0;title\u0007\nretry"
    const failure = await runCommand(process.execPath, [
      "-e",
      `process.stderr.write(${JSON.stringify(diagnostic)}, () => process.exit(4))`,
    ]).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CommandExecutionError)
    expect((failure as Error).message).toContain("permission denied")
    expect((failure as Error).message).toContain("retry")
    expect((failure as Error).message).not.toContain("title")
    expect((failure as Error).message).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  })

  it("bounds failed stderr at 64 KiB and explicitly marks truncation", async () => {
    const label = "Inspect failed local step"
    const failure = await runCommand(
      process.execPath,
      [
        "-e",
        `process.stderr.write("diagnostic-start:" + "é".repeat(64 * 1024) + ":omitted-tail",
          () => process.exit(5))`,
      ],
      { label },
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CommandExecutionError)
    const message = (failure as Error).message
    expect(message).toContain(label)
    expect(message).toContain("diagnostic-start:")
    expect(message).not.toContain(":omitted-tail")
    expect(message).toMatch(/truncat/i)
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(64 * 1024 + 512)
  })

  it("preserves the error constructor's cancellation argument and optional exit code", () => {
    const cancelled = new CommandExecutionError("Cancelled", true)
    const failed = new CommandExecutionError("Failed", false, 17)

    expect(cancelled.aborted).toBe(true)
    expect(cancelled.exitCode).toBeUndefined()
    expect(failed.aborted).toBe(false)
    expect(failed.exitCode).toBe(17)
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
