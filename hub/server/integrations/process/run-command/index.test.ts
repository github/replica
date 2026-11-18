import { describe, expect, it } from "vitest"

import { runCommand } from "."

describe("runCommand()", () => {
  it.each(["stdout", "stderr"] as const)(
    "reports the command and exit code without disclosing %s",
    async (stream) => {
      const secret = "https://token@example.com/private-package"
      let failure: unknown
      try {
        await runCommand({
          command: process.execPath,
          arguments: ["-e", `process.${stream}.write(${JSON.stringify(secret)}); process.exit(2)`],
          cwd: process.cwd(),
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toEqual(
        new Error(`${process.execPath} exited with code 2 while preparing local development.`),
      )
      expect((failure as Error).message).not.toContain(secret)
    },
  )
})
