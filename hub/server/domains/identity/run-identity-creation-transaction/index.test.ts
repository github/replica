import { describe, expect, it } from "vitest"

import { createKnownRequestError } from "../../../../test/prisma/create-known-request-error"
import { IdentityTransactionConflictError } from "../errors"
import type { IdentityDatabaseClient } from "./types"
import { runIdentityCreationTransaction } from "."

function rejectingDatabase(error: Error): IdentityDatabaseClient {
  return {
    $transaction: () => Promise.reject(error),
  }
}

describe("runIdentityCreationTransaction()", () => {
  it.each(["P2002", "P2034"])("translates retryable %s errors", async (code) => {
    await expect(
      runIdentityCreationTransaction(rejectingDatabase(createKnownRequestError(code)), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBeInstanceOf(IdentityTransactionConflictError)
  })

  it("leaves foreign-key failures non-retryable", async () => {
    const error = createKnownRequestError("P2003")

    await expect(
      runIdentityCreationTransaction(rejectingDatabase(error), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBe(error)
  })
})
