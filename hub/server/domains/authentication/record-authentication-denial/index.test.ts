import { describe, expect, it, vi } from "vitest"

import { AuthenticationProofError } from "../errors"
import { recordAuthenticationDenial } from "."

describe("recordAuthenticationDenial()", () => {
  it("resolves after recording the denial audit without throwing the primary failure", async () => {
    const primary = new AuthenticationProofError("provider_failed", "Safe failure.")
    const writeAudit = vi.fn(() => Promise.resolve())

    await expect(recordAuthenticationDenial(primary, writeAudit)).resolves.toBeUndefined()
    expect(writeAudit).toHaveBeenCalledOnce()
  })

  it("throws an aggregate containing the primary and audit failures when auditing fails", async () => {
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
