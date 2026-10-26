import { render } from "@testing-library/react"
import { describe, it } from "vitest"

import { GithubAppSetupRegisterPage } from "./index"
import type { GithubAppSetupRegisterPageData } from "./types"

const PAGE_DATA: GithubAppSetupRegisterPageData = {
  access: "You choose which repositories it can access.",
  description: "Replica Hub uses a private GitHub App.",
  heading: "Connect Replica Hub to GitHub.",
  manualLabel: "Connect an existing App",
  manualPath: "/setup/manual",
  manifest: '{"name":"Replica Hub"}',
  pageTitle: "Create App",
  productName: "Replica Hub",
  submitLabel: "Create the App on GitHub",
  submitPath: "https://github.com/settings/apps/new",
}

describe("GithubAppSetupRegisterPage()", () => {
  it("renders a native external manifest form", () => {
    const { container } = render(<GithubAppSetupRegisterPage data={PAGE_DATA} />)
    const form = container.querySelector("form")

    expect(form).toHaveAttribute("action", "https://github.com/settings/apps/new")
    expect(form).not.toHaveAttribute("data-sg-visit")
    expect(container.querySelector("input[name=manifest]")).toHaveValue('{"name":"Replica Hub"}')
  })
})
