import { describe, expect, it } from "vitest"

import { Prisma } from "../../../generated/prisma/client"
import { IdentityTransactionConflictError } from "../errors"
import type { IdentityDatabaseClient } from "./types"
import { runIdentityCreationTransaction } from "."

function databaseError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("database failure", {
    clientVersion: "7.10.1",
    code,
  })
}

function rejectingDatabase(error: Error): IdentityDatabaseClient {
  return {
    $transaction: () => Promise.reject(error),
  }
}

describe("runIdentityCreationTransaction()", () => {
  it.each(["P2002", "P2034"])("translates retryable %s errors", async (code) => {
    await expect(
      runIdentityCreationTransaction(rejectingDatabase(databaseError(code)), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBeInstanceOf(IdentityTransactionConflictError)
  })

  it("leaves foreign-key failures non-retryable", async () => {
    const error = databaseError("P2003")

    await expect(
      runIdentityCreationTransaction(rejectingDatabase(error), () =>
        Promise.resolve("unreachable"),
      ),
    ).rejects.toBe(error)
  })
})
