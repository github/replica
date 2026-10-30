import { describe, expect, it } from "vitest"

import { createKnownRequestError } from "../../../../test/prisma/create-known-request-error"
import { IdentityTransactionConflictError } from "../errors"
import type { ProviderRevisionDatabaseClient } from "./types"
import { runProviderRevisionTransaction } from "."

function rejectingDatabase(error: Error): ProviderRevisionDatabaseClient {
  return {
    $transaction: () => Promise.reject(error),
  }
}

describe("runProviderRevisionTransaction()", () => {
  it.each(["P2002", "P2034"])("translates retryable %s errors", async (code) => {
    await expect(
      runProviderRevisionTransaction(rejectingDatabase(createKnownRequestError(code)), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBeInstanceOf(IdentityTransactionConflictError)
  })

  it("leaves foreign-key failures non-retryable", async () => {
    const error = createKnownRequestError("P2003")

    await expect(
      runProviderRevisionTransaction(rejectingDatabase(error), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBe(error)
  })
})
