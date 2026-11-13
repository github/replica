import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { GithubAppSetupShowPage } from "."
import type { GithubAppSetupShowPageData } from "./types"

const PAGE_DATA: GithubAppSetupShowPageData = {
  authenticityToken: "csrf-token",
  description: "Connect a private GitHub App.",
  heading: "Connect GitHub.",
  organizationHint: "Leave blank for a personal account.",
  organizationLabel: "Organization",
  pageTitle: "Setup",
  productName: "Replica Hub",
  secretLabel: "Bootstrap secret",
  submitLabel: "Continue",
  submitPath: "/setup",
}

describe("GithubAppSetupShowPage()", () => {
  it("renders the protected setup form", () => {
    render(<GithubAppSetupShowPage data={PAGE_DATA} />)

    expect(document.querySelector("section.setup__card")).toBeInTheDocument()
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveAttribute("name", "bootstrap_secret")
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveAttribute("required")
    expect(screen.getByLabelText("Organization")).toHaveAttribute("name", "organization")
    expect(document.querySelector("input[name=authenticity_token]")).toHaveValue("csrf-token")
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument()
  })
})
