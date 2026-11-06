import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubSpinner } from "."

describe("HubSpinner()", () => {
  it("names a standalone progress indicator", () => {
    render(<HubSpinner label="Loading comments" size="small" />)

    expect(screen.getByRole("status", { name: "Loading comments" })).toBeInTheDocument()
  })

  it("is decorative when a visible loading label follows", () => {
    render(
      <div>
        <HubSpinner decorative />
        Loading comments
      </div>,
    )

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.getByText("Loading comments")).toBeInTheDocument()
  })
})
