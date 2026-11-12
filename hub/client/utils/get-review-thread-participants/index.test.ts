import { describe, expect, it } from "vitest"

import type { ReviewCommentAuthor } from "@utils/review-comment/types"

import { getReviewThreadParticipants } from "."

const OCTOCAT: ReviewCommentAuthor = {
  login: "octocat",
  name: "The Octocat",
  avatarUrl: null,
}
const MONA: ReviewCommentAuthor = {
  login: "mona",
  name: "Mona Lisa",
  avatarUrl: null,
}
const HUBOT: ReviewCommentAuthor = {
  login: "hubot",
  name: "Hubot",
  avatarUrl: null,
}

describe("getReviewThreadParticipants()", () => {
  it("keeps the root author first and the latest distinct reply authors next", () => {
    expect(getReviewThreadParticipants(OCTOCAT, [MONA, HUBOT, OCTOCAT, MONA])).toEqual([
      OCTOCAT,
      MONA,
      HUBOT,
    ])
  })
})
