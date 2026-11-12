import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CopilotConnectionPage } from "."
import story, { AccessRemoved, Connected, NoToken, Refused } from "./stories"
import type { CopilotConnectionPageData } from "./types"

function renderPage(data: CopilotConnectionPageData) {
  render(
    <ThemeProvider>
      <CopilotConnectionPage data={data} />
    </ThemeProvider>,
  )
}

describe("CopilotConnectionPage()", () => {
  it("asks for confirmation before connecting and says who pays for usage", () => {
    renderPage(story.args.data)
    expect(screen.getByRole("heading", { name: "Copilot is not connected" })).toBeInTheDocument()
    expect(
      screen.getByText(/GitHub attributes usage .* represented by that credential/),
    ).toBeInTheDocument()
    const checkbox = screen.getByRole("checkbox", {
      name: "I understand and confirm connecting Copilot for this Hub.",
    })
    expect(checkbox).toBeRequired()
    expect(checkbox).not.toBeChecked()
    const form = screen.getByRole("button", { name: "Connect Copilot" }).closest("form")
    expect(form).toHaveAttribute("action", "/settings/copilot")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('[name="_method"]')).toBeNull()
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(screen.queryByRole("button", { name: "Disconnect Copilot" })).not.toBeInTheDocument()
  })

  it("shows who connected Copilot and offers only disconnecting", () => {
    renderPage(Connected.args!.data!)
    expect(
      screen.getByText(
        "@octocat connected Copilot. Membership 9b96cae1-099f-474f-bb1f-6f8ef78a4575.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Copilot last answered on 2026-11-10T23:00:00.000Z."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Connect Copilot/ })).not.toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Disconnect Copilot" }).closest("form")
    expect(form?.querySelector('[name="_method"]')).toHaveValue("delete")
    expect(
      screen.getByRole("checkbox", {
        name: "I understand and confirm disconnecting Copilot for this Hub.",
      }),
    ).toBeRequired()
  })

  it("explains a refused credential and offers to check and connect it", () => {
    renderPage(Refused.args!.data!)
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      /Copilot refused the configured credential/,
    )
    expect(screen.getByRole("button", { name: "Check and connect Copilot" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Disconnect Copilot" })).not.toBeInTheDocument()
  })

  it("shows explicit local credential-provider guidance when none is configured", () => {
    renderPage(NoToken.args!.data!)
    expect(screen.getByRole("alert")).toHaveTextContent(/ambient CLI authentication/)
    expect(screen.getByRole("alert")).toHaveTextContent(/environment-token provider/)
    expect(screen.queryByRole("button", { name: "Connect Copilot" })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("shows nothing about the connection to someone who is not a Hub administrator", () => {
    renderPage(AccessRemoved.args!.data!)
    expect(
      screen.getByText("Only Hub administrators can view or change the Copilot connection."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Copilot" })).not.toBeInTheDocument()
  })
})
