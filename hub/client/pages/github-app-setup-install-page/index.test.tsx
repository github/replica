import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { GithubAppSetupInstallPage } from "."
import type { GithubAppSetupInstallPageData } from "./types"

const PAGE_DATA: GithubAppSetupInstallPageData = {
  description: "The private GitHub App is ready to install on prototype repositories.",
  heading: "Replica Hub is connected",
  pageTitle: "GitHub connected",
  productName: "Replica Hub",
}

describe("GithubAppSetupInstallPage()", () => {
  it("confirms that the GitHub App is ready to install", () => {
    render(<GithubAppSetupInstallPage data={PAGE_DATA} />)

    expect(screen.getByText("Replica Hub")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Replica Hub is connected" })).toBeInTheDocument()
    expect(
      screen.getByText("The private GitHub App is ready to install on prototype repositories."),
    ).toBeInTheDocument()
  })
})
