import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"

import { MentionText } from "."

describe("MentionText()", () => {
  it("highlights only server-recognized tokens and never renders markup", () => {
    const { container } = render(
      <p>
        <MentionText
          comment={{
            ...octocatRootComment,
            body: "@mona @hubot email@mona <script>unsafe</script>",
            mentions: [{ login: "mona", githubId: 1002 }],
          }}
        />
      </p>,
    )
    expect(container.querySelectorAll(".mention-text")).toHaveLength(1)
    expect(container.querySelector(".mention-text")).toHaveTextContent("@mona")
    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText(/<script>unsafe<\/script>/)).toBeInTheDocument()
  })

  it("highlights the complete verified managed username without matching an unverified prefix", () => {
    const { container } = render(
      <MentionText
        comment={{
          ...octocatRootComment,
          body: "@mona_enterprise @mona @mona_enterprise_extra",
          mentions: [{ login: "mona_enterprise", githubId: 1002 }],
        }}
      />,
    )
    expect(container.querySelectorAll(".mention-text")).toHaveLength(1)
    expect(container.querySelector(".mention-text")).toHaveTextContent("@mona_enterprise")
    expect(container).toHaveTextContent("@mona_enterprise @mona @mona_enterprise_extra")
  })
})
