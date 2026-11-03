import { describe, expect, it, vi } from "vitest"

import { IdentityTransactionConflictError } from "../errors"
import { runWithBoundedRetries } from "."

describe("runWithBoundedRetries()", () => {
  it("uses the kernel-owned three-attempt budget and bounded delays", async () => {
    vi.useFakeTimers()
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new IdentityTransactionConflictError())
      .mockRejectedValueOnce(new IdentityTransactionConflictError())
      .mockResolvedValue("recovered")

    const result = runWithBoundedRetries(
      operation,
      (error) => error instanceof IdentityTransactionConflictError,
    )
    await vi.advanceTimersByTimeAsync(15)

    await expect(result).resolves.toBe("recovered")
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3])
  })

  it("stops at the fixed bound without consumer configuration", async () => {
    vi.useFakeTimers()
    const failure = new IdentityTransactionConflictError()
    const operation = vi.fn(() => Promise.reject(failure))

    const result = runWithBoundedRetries(
      operation,
      (error) => error instanceof IdentityTransactionConflictError,
    )
    const assertion = expect(result).rejects.toBe(failure)
    await vi.runAllTimersAsync()

    await assertion
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it("fails non-retryable errors once", async () => {
    const failure = new Error("non-retryable")
    const operation = vi.fn(() => Promise.reject(failure))

    await expect(
      runWithBoundedRetries(
        operation,
        (error) => error instanceof IdentityTransactionConflictError,
      ),
    ).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledOnce()
  })
})
