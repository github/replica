import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

import { createReviewCommentService } from "."

describe("createReviewCommentService()", () => {
  it("rejects a mutation when transaction-bound session authority is gone", async () => {
    const transaction = vi.fn(async (operation: (client: never) => Promise<unknown>) =>
      operation({} as never),
    )
    const service = createReviewCommentService(
      { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction">,
      () => Promise.resolve(false),
    )

    await expect(
      service.deleteComment({
        sessionDigest: "a".repeat(64),
        repositoryId: "4bb7f30d-d68e-45c7-b15f-a5e1bcd6ac43",
        prototypeId: "ddcbd25d-72b4-45be-9324-677b4ca04dac",
        commentId: 1,
        actor: {
          userId: "1d92c847-f217-4c48-9824-e25d4a36f821",
          login: "mona",
          name: "Mona",
        },
      }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: "Sign in to continue.",
    })
  })

  it("returns a conflict after bounded transaction retries are exhausted", async () => {
    const transaction = vi.fn().mockRejectedValue({ originalCode: "40001" })
    const service = createReviewCommentService({ $transaction: transaction })

    await expect(
      service.deleteComment({
        sessionDigest: "a".repeat(64),
        repositoryId: "4bb7f30d-d68e-45c7-b15f-a5e1bcd6ac43",
        prototypeId: "ddcbd25d-72b4-45be-9324-677b4ca04dac",
        commentId: 1,
        actor: {
          userId: "1d92c847-f217-4c48-9824-e25d4a36f821",
          login: "mona",
          name: "Mona",
        },
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "The review thread changed. Try again.",
    })
    expect(transaction).toHaveBeenCalledTimes(3)
  })
})
