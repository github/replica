import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { HubContentPageHeader } from "."

describe("HubContentPageHeader()", () => {
  it("keeps the heading in the same row with or without supporting content", () => {
    const { rerender } = render(<HubContentPageHeader title="History" />)
    const heading = screen.getByRole("heading", { name: "History", level: 2 })
    expect(heading.parentElement).toHaveClass("hub-content-page-header__top")

    rerender(
      <HubContentPageHeader
        title="Share links"
        description="Share one fixed Build."
        trailing={<span>Successful</span>}
      />,
    )

    expect(
      screen.getByRole("heading", { name: "Share links", level: 2 }).parentElement,
    ).toHaveClass("hub-content-page-header__top")
    expect(screen.getByText("Successful").parentElement).toHaveClass("hub-content-page-header__top")
    expect(screen.getByText("Share one fixed Build.")).toBeInTheDocument()
  })
})
