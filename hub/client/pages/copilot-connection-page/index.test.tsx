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
  it("asks for confirmation before connecting and says who pays for the usage", () => {
    renderPage(story.args.data)
    expect(screen.getByRole("heading", { name: "Copilot is not connected" })).toBeInTheDocument()
    expect(
      screen.getByText(/The usage counts toward the Copilot plan of the token's owner/),
    ).toBeInTheDocument()
    const checkbox = screen.getByRole("checkbox", {
      name: "I understand that Hub will use this Copilot token for this Hub.",
    })
    expect(checkbox).toBeRequired()
    expect(checkbox).not.toBeChecked()
    const form = screen.getByRole("button", { name: "Connect Copilot" }).closest("form")
    expect(form).toHaveAttribute("action", "/copilot")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('[name="_method"]')).toBeNull()
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(screen.queryByRole("button", { name: "Disconnect Copilot" })).not.toBeInTheDocument()
  })

  it("shows who connected Copilot and offers only disconnecting", () => {
    renderPage(Connected.args!.data!)
    expect(screen.getByText(/@octocat connected Copilot on October 9, 2026/)).toBeInTheDocument()
    expect(screen.getByText("Copilot last answered on October 10, 2026.")).toBeInTheDocument()
    expect(
      screen.getByText(/Learnings used 0.147 AI credits in 2 Copilot requests/),
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

  it("explains a refused token and offers to check it again", () => {
    renderPage(Refused.args!.data!)
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/Copilot refused the token/)
    expect(screen.getByRole("button", { name: "Check the token again" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disconnect Copilot" })).toBeInTheDocument()
  })

  it("says how to give Hub a token, and offers no connection without one", () => {
    renderPage(NoToken.args!.data!)
    expect(screen.getByRole("alert")).toHaveTextContent(/REPLICA_COPILOT_TOKEN/)
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
