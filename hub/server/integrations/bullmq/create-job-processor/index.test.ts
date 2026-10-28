import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createJobProcessor } from "."

describe("createJobProcessor()", () => {
  it("preserves unexpected schema errors as retryable failures", async () => {
    const failure = new Error("Schema dependency failure")
    const process = vi.fn(() => Promise.resolve("must not run"))
    const processor = createJobProcessor(
      {
        name: "schema-failure",
        schema: z.string().transform(() => {
          throw failure
        }),
      },
      process,
    )

    await expect(processor.process("valid input")).rejects.toBe(failure)
    expect(process).not.toHaveBeenCalled()
  })
})
