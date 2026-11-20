import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { latestReviewOutcome } from "../src/review-outcomes.mjs"

function outcome(sequence, value, stale = false) {
  return {
    type: "x-replica.review_outcome",
    payload: { sequence, outcome: value, stale },
  }
}

describe("latestReviewOutcome()", () => {
  it("uses the latest explicit reviewer result and leaves older evidence as legacy", () => {
    assert.equal(latestReviewOutcome([{ type: "human_comment", payload: {} }]), null)
    assert.equal(
      latestReviewOutcome([outcome(2, "needs_more_review"), outcome(1, "confirmed_fixed")]).payload
        .outcome,
      "needs_more_review",
    )
  })

  it("preserves stale and contradictory outcomes so instruction and reward callers can fail closed", () => {
    assert.deepEqual(latestReviewOutcome([outcome(1, "still_present", true)]).payload, {
      sequence: 1,
      outcome: "still_present",
      stale: true,
    })
  })
})
