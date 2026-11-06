import { expect, it } from "vitest"
import { runCommand } from "./index.ts"

it("refuses an already cancelled command without starting it", async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(
    runCommand(process.execPath, ["-e", "process.exit(0)"], {
      signal: abort.signal,
    }),
  ).rejects.toThrow()
})

it("terminates running work when the operator cancels", async () => {
  const abort = new AbortController()
  const pending = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: abort.signal,
  })
  abort.abort()
  await expect(pending).rejects.toThrow("failed")
})
