import { describe, expect, it, vi } from "vitest"

import { IdentityTransactionConflictError } from "../errors"
import { runWithBoundedRetries } from "."

describe("runWithBoundedRetries()", () => {
  it("retries retryable failures with bounded exponential delays", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new IdentityTransactionConflictError())
      .mockRejectedValueOnce(new IdentityTransactionConflictError())
      .mockResolvedValue("recovered")
    const sleep = vi.fn<(delayMs: number) => Promise<void>>().mockResolvedValue(undefined)

    await expect(
      runWithBoundedRetries(operation, {
        baseDelayMs: 5,
        maxAttempts: 3,
        maxDelayMs: 8,
        shouldRetry: (error) => error instanceof IdentityTransactionConflictError,
        sleep,
      }),
    ).resolves.toBe("recovered")
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3])
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([5, 8])
  })

  it("stops after the configured attempt budget", async () => {
    const failure = new IdentityTransactionConflictError()
    const operation = vi.fn(() => Promise.reject(failure))

    await expect(
      runWithBoundedRetries(operation, {
        baseDelayMs: 0,
        maxAttempts: 2,
        maxDelayMs: 0,
        shouldRetry: (error) => error instanceof IdentityTransactionConflictError,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("does not retry non-retryable failures", async () => {
    const failure = new Error("non-retryable")
    const operation = vi.fn(() => Promise.reject(failure))
    const sleep = vi.fn<(delayMs: number) => Promise<void>>()

    await expect(
      runWithBoundedRetries(operation, {
        baseDelayMs: 5,
        maxAttempts: 3,
        maxDelayMs: 10,
        shouldRetry: (error) => error instanceof IdentityTransactionConflictError,
        sleep,
      }),
    ).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })
})
