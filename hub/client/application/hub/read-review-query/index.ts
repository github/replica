import { z } from "zod"

import { ApiRequestError } from "../requests/api-request-error"

const flag = z.enum(["0", "1"]).optional()
const schema = z.object({
  comment: z.coerce.number().int().positive().optional(),
  commentSearch: z.string().max(200).default(""),
  commentBuild: flag,
  commentPage: flag,
  commentResolved: flag,
  commentUnread: flag,
  commentMine: flag,
  commentParticipant: z.string().max(100).optional(),
})

export function readReviewQuery(search: URLSearchParams) {
  const parsed = schema.safeParse(Object.fromEntries(search))
  if (!parsed.success) throw new ApiRequestError(400, "The review filters are invalid.")
  const query = parsed.data
  return {
    commentId: query.comment ?? null,
    filters: {
      search: query.commentSearch,
      currentBuildOnly: query.commentBuild === "1",
      currentPageOnly: query.commentPage === "1",
      showResolved: query.commentResolved === "1",
      showRead: query.commentUnread !== "1",
      onlyMine: query.commentMine === "1",
      participant: query.commentParticipant || null,
    },
  }
}
