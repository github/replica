import { z } from "zod"

export const redactReviewCommentJob = {
  name: "learning.redact-review-comment",
  schema: z
    .object({
      repositoryId: z.uuid(),
      commentId: z.number().int().positive(),
      actor: z.string().regex(/^(?:github|human):\S+$/),
    })
    .strict(),
  options: { attempts: 120, backoff: { type: "fixed", delay: 30_000 } },
}
