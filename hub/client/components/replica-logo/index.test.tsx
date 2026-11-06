import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReplicaLogo } from "."

describe("ReplicaLogo()", () => {
  it("names the whole lockup once and hides its visual parts from assistive technology", () => {
    render(<ReplicaLogo />)

    const logo = screen.getByRole("img", { name: "Replica" })
    expect(screen.getAllByRole("img")).toHaveLength(1)
    expect(logo.querySelector(".replica-logo__mark")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("Replica")).toHaveAttribute("aria-hidden", "true")
  })
})
