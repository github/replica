import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CanvasPairingsPage } from "."
import type { CanvasPairingsPageData } from "./types"

describe("CanvasPairingsPage()", () => {
  it("asks the reviewer to match the code before approving a repository connection", () => {
    const data: CanvasPairingsPageData = {
      kind: "approval",
      pageTitle: "Connect Replica canvas",
      productName: "Replica Hub",
      heading: "Connect Replica canvas",
      description: "Confirm this connection before letting Copilot access your Hub reviews.",
      codeLabel: "Connection code",
      codeInstruction: "Only approve if this code matches the one shown in Copilot.",
      code: "ABCDEF1234",
      repositoryLabel: "Repository",
      repository: "local/example",
      permissions:
        "The connection also lets Copilot add the learnings this repository's administrators accepted to your prompts.",
      learningsConsentVersion: "1",
      expiration: "Connections expire after seven days. You can revoke access from",
      connectionsLabel: "Canvas connections",
      connectionsPath: "/canvas/connections",
      approveLabel: "Approve connection",
      approvePath: "/canvas/pair/ABCDEF1234",
      cancelLabel: "Cancel",
      cancelPath: "/repositories",
      authenticityToken: "csrf-token",
    }

    render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("heading", { name: "Connect Replica canvas" })).toBeInTheDocument()
    expect(screen.getByText("ABCDEF1234")).toBeInTheDocument()
    expect(screen.getByText("local/example")).toBeInTheDocument()
    expect(screen.getByText(data.permissions)).toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Approve connection" }).closest("form")
    expect(form).toHaveAttribute("action", "/canvas/pair/ABCDEF1234")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(form?.querySelector('input[name="learnings_consent_version"]')).toHaveValue("1")
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/repositories")
  })

  it("shows revocable connections after approval", () => {
    const data: CanvasPairingsPageData = {
      kind: "connections",
      pageTitle: "Canvas connections",
      productName: "Replica Hub",
      heading: "Canvas connections",
      description: "Review the repositories connected to your Copilot canvases.",
      authenticityToken: "csrf-token",
      emptyLabel: "No active connections.",
      backLabel: "Back to repositories",
      backPath: "/repositories",
      revokeLabel: "Revoke",
      notice: "Replica canvas connected to local/example.",
      grants: [
        {
          id: 1,
          repository: "local/example",
          expiresLabel: "Expires October 1, 2026 at 12:00 UTC",
          revokePath: "/canvas/connections/1",
        },
      ],
    }

    render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("connected to local/example")
    expect(screen.getByText("local/example")).toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Revoke" }).closest("form")
    expect(form).toHaveAttribute("action", "/canvas/connections/1")
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(screen.getByRole("link", { name: "Back to repositories" })).toHaveAttribute(
      "href",
      "/repositories",
    )
  })
})
