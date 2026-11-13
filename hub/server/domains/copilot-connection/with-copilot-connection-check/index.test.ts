import { describe, expect, it, vi } from "vitest"

import { createCopilotConnectionCheckLimit } from "."

describe("createCopilotConnectionCheckLimit()", () => {
  it("rejects a competing check before it starts another operation", async () => {
    let finish!: () => void
    const firstOperation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const competingOperation = vi.fn().mockResolvedValue(undefined)
    const withCheck = createCopilotConnectionCheckLimit()
    const first = withCheck(firstOperation)

    await expect(withCheck(competingOperation)).rejects.toMatchObject({ code: "busy" })
    expect(competingOperation).not.toHaveBeenCalled()

    finish()
    await first
    await expect(withCheck(competingOperation)).resolves.toBeUndefined()
    expect(competingOperation).toHaveBeenCalledOnce()
  })

  it("releases capacity after a failed check", async () => {
    const failure = new Error("status failed")
    const withCheck = createCopilotConnectionCheckLimit()

    await expect(withCheck(() => Promise.reject(failure))).rejects.toBe(failure)
    await expect(withCheck(() => Promise.resolve("ready"))).resolves.toBe("ready")
  })
})
