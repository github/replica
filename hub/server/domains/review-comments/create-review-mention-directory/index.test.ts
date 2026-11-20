import { describe, expect, it } from "vitest"

import { reviewMentionLogins } from "."

describe("reviewMentionLogins()", () => {
  it("extracts a whole managed account, deduplicates its casing, and preserves ordinary mentions", () => {
    expect(
      reviewMentionLogins(
        "Please ask @Reviewer_Enterprise, @ordinary-reviewer, and @reviewer_enterprise.",
      ),
    ).toEqual(["reviewer_enterprise", "ordinary-reviewer"])
  })

  it("accepts a 39-character managed mention without truncating an overlong account", () => {
    const login = `${"r".repeat(34)}_corp`
    const overlong = `${"s".repeat(34)}_corpx`

    expect(reviewMentionLogins(`Ask @${login} and @${overlong}, then @reviewer.`)).toEqual([
      login,
      "reviewer",
    ])
  })
})
