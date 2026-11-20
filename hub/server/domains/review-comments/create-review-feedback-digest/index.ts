import { createHash } from "node:crypto"

export function createReviewFeedbackDigest(input: {
  body: string
  editedAt: Date | null
  deletedAt: Date | null
}) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        body: input.body,
        editedAt: input.editedAt?.toISOString() ?? null,
        deletedAt: input.deletedAt?.toISOString() ?? null,
      }),
    )
    .digest("hex")}` as const
}
