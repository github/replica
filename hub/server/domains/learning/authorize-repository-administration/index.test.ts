import { describe, expect, it, vi } from "vitest"

import { Prisma } from "../../../generated/prisma/client"
import { authorizeRepositoryAdministration } from "."

describe("authorizeRepositoryAdministration()", () => {
  it("retries a transient database conflict before returning authority", async () => {
    const fakeTransaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ enabled: true, selectedRevisionId: "provider-revision" }])
        .mockResolvedValueOnce([{ lifecycle: "ACTIVE" }])
        .mockResolvedValueOnce([{ githubRepositoryId: 1n, removedAt: null }])
        .mockResolvedValueOnce([{ accessLevel: "ADMIN" }]),
    }
    const database = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError("Serialization conflict", {
            code: "P2034",
            clientVersion: "test",
          }),
        )
        .mockImplementationOnce(
          (operation: (transaction: typeof fakeTransaction) => Promise<boolean>) =>
            operation(fakeTransaction),
        ),
    }

    await expect(
      authorizeRepositoryAdministration(database, {
        membershipId: "11111111-2222-4333-8444-555555555555",
        repositoryId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      }),
    ).resolves.toBe(true)
    expect(database.$transaction).toHaveBeenCalledTimes(2)
  })
})
