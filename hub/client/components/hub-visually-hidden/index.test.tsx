import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubVisuallyHidden } from "."

describe("HubVisuallyHidden()", () => {
  it("keeps text in the accessible name", () => {
    render(
      <button>
        <HubVisuallyHidden>Choose rocket reaction</HubVisuallyHidden>
      </button>,
    )

    expect(screen.getByRole("button", { name: "Choose rocket reaction" })).toBeInTheDocument()
  })
})
