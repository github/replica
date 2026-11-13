import { Prisma } from "../../../generated/prisma/client"
import { describe, expect, it, vi } from "vitest"

import { runCopilotConnectionTransaction } from "."

describe("runCopilotConnectionTransaction()", () => {
  it.each(["P2002", "P2034"])(
    "maps retryable transaction conflict %s to connection_changed",
    async (code) => {
      const conflict = new Prisma.PrismaClientKnownRequestError("transaction conflict", {
        clientVersion: "test",
        code,
      })
      const database = {
        $transaction: vi.fn().mockRejectedValue(conflict),
      }

      await expect(
        runCopilotConnectionTransaction(database, vi.fn(), vi.fn()),
      ).rejects.toMatchObject({
        code: "connection_changed",
        cause: conflict,
      })
    },
  )
})
