import { expect, it, vi } from "vitest"

import type { RunCommand } from "../../types.ts"
import { withDefaultSignal } from "./index.ts"

it("uses the session signal when the caller supplies none", async () => {
  const session = new AbortController()
  const run = vi.fn<RunCommand>(async () => "")

  await withDefaultSignal(run, session.signal)("az", ["account", "show"], { label: "check" })

  expect(run).toHaveBeenCalledWith("az", ["account", "show"], {
    label: "check",
    signal: session.signal,
  })
})

it("keeps a caller signal after the session is cancelled", async () => {
  const session = new AbortController()
  session.abort()
  const cleanup = AbortSignal.timeout(15_000)
  const run = vi.fn<RunCommand>(async () => "")

  await withDefaultSignal(run, session.signal)("az", ["storage", "blob", "lease", "release"], {
    signal: cleanup,
  })

  expect(run.mock.calls[0]![2]!.signal).toBe(cleanup)
})
