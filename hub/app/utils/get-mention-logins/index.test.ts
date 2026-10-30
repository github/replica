import { describe, expect, it } from "vitest"

import { getMentionLogins } from "."

describe("getMentionLogins()", () => {
  it("counts distinct message logins case-insensitively without treating email or URLs as mentions", () => {
    expect(getMentionLogins("@mona @MONA hello@hubot.test /@octocat @hubot")).toEqual([
      "mona",
      "hubot",
    ])
  })

  it("recognizes the exact ten-message boundary independently for each body", () => {
    const ten = Array.from({ length: 10 }, (_, index) => `@person${index}`).join(" ")
    expect(getMentionLogins(ten)).toHaveLength(10)
    expect(getMentionLogins(`${ten} @eleventh`)).toHaveLength(11)
    expect(getMentionLogins(ten)).toHaveLength(10)
  })
})
