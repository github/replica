import { describe, expect, it, vi } from "vitest"

import { AuthenticationProofError } from "../errors"
import { recordAuthenticationDenial } from "."

describe("recordAuthenticationDenial()", () => {
  it("records one audit and preserves the primary typed failure", async () => {
    const primary = new AuthenticationProofError("provider_failed", "Safe failure.")
    const writeAudit = vi.fn(() => Promise.resolve())

    await expect(
      recordAuthenticationDenial(primary, writeAudit).then(() => {
        throw primary
      }),
    ).rejects.toBe(primary)
    expect(writeAudit).toHaveBeenCalledOnce()
  })

  it("retains both the typed primary failure and audit failure", async () => {
    const primary = new AuthenticationProofError("provider_failed", "Safe failure.")
    const audit = new Error("audit unavailable")
    const writeAudit = vi.fn(() => Promise.reject(audit))

    const error = await recordAuthenticationDenial(primary, writeAudit).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([primary, audit])
    expect(writeAudit).toHaveBeenCalledOnce()
  })
})
