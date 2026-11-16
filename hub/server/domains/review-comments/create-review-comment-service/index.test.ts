import { describe, expect, it, vi } from "vitest"

import { createReviewCommentService } from "."

describe("createReviewCommentService()", () => {
  it("returns a conflict after bounded transaction retries are exhausted", async () => {
    const transaction = vi.fn().mockRejectedValue({ originalCode: "40001" })
    const service = createReviewCommentService({ $transaction: transaction })

    await expect(
      service.deleteComment({
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
