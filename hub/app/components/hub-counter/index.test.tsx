import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubCounter } from "."

describe("HubCounter()", () => {
  it("preserves exact counts and caller accessibility attributes", () => {
    render(
      <HubCounter className="pending" aria-label="27 pending requests">
        {27}
      </HubCounter>,
    )
    expect(screen.getByLabelText("27 pending requests")).toHaveTextContent("27")
  })
})
