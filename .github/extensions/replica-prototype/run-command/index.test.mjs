import assert from "node:assert/strict"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { runCommand } from "./index.mjs"

describe("runCommand()", () => {
  it("preserves literal arguments, the working directory and the supplied environment", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "replica-run-command-"))
    try {
      const cwd = await realpath(directory)
      const argument = "$(printf not-a-shell)"
      const result = await runCommand(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify([process.cwd(), process.argv[1], process.env.REPLICA_COMMAND_TEST]))",
          argument,
        ],
        cwd,
        { env: { REPLICA_COMMAND_TEST: "present" } },
      )
      assert.equal(result.ok, true)
      assert.deepEqual(JSON.parse(result.stdout), [cwd, argument, "present"])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("reports a missing executable without inventing process output", async () => {
    const command = "/replica-command-test/missing-executable"
    assert.deepEqual(await runCommand(command, [], process.cwd()), {
      ok: false,
      error: `${command} is not installed.`,
    })
  })

  it("retains the exit code and both output streams from a failed command", async () => {
    assert.deepEqual(
      await runCommand(process.execPath, [
        "-e",
        'process.stdout.write("partial result"); process.stderr.write("  command failed\\n"); process.exitCode = 7',
      ]),
      {
        ok: false,
        error: "command failed",
        exitCode: 7,
        stdout: "partial result",
        stderr: "  command failed\n",
      },
    )
    const withoutStderr = await runCommand(process.execPath, ["-e", "process.exitCode = 8"])
    assert.equal(withoutStderr.ok, false)
    assert.equal(withoutStderr.exitCode, 8)
    assert.match(withoutStderr.error, /Command failed/)

    const signaled = await runCommand(process.execPath, [
      "-e",
      'process.kill(process.pid, "SIGTERM")',
    ])
    assert.equal(signaled.ok, false)
    assert.equal(signaled.exitCode, null)
  })
})
