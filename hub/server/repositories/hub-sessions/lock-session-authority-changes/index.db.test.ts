import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { lockRepositoryAdministrationChanges } from "../../repository-access/lock-repository-administration-changes"
import { lockSessionAuthorityChanges } from "."

describe("authority advisory locks", () => {
  it("restores the transaction lock timeout after bounded acquisition", async () => {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL lock_timeout = '7s'`

      await lockRepositoryAdministrationChanges(transaction, { timeoutMs: 500 })
      await lockSessionAuthorityChanges(transaction, { timeoutMs: 500 })

      const [setting] = await transaction.$queryRaw<Array<{ lock_timeout: string }>>`
        SHOW lock_timeout
      `
      expect(setting?.lock_timeout).toBe("7s")
    })
  })
})
