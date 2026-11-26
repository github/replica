import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { AgentConnectionsPrototype } from "."
import type { AgentConnectionsPrototypeData } from "./types"

function renderPrototype(data: AgentConnectionsPrototypeData) {
  render(<AgentConnectionsPrototype data={data} />, { wrapper: HubThemeProvider })
}

describe("AgentConnectionsPrototype()", () => {
  it("copies a repository MCP endpoint without putting a credential in the config", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    const data: AgentConnectionsPrototypeData = {
      repositoryId: "2001",
      repositoryName: "github/prototype",
      hubUrl: "https://hub.example.com",
      signedInAs: "@octocat",
      view: "connections",
      connections: [],
    }
    renderPrototype(data)

    const config = screen.getByLabelText("Hub MCP configuration")
    expect(config).toHaveTextContent("https://hub.example.com/mcp/repositories/2001")
    expect(config).not.toHaveTextContent(/token|secret|password/i)
    fireEvent.click(screen.getByRole("button", { name: "Copy: Hub MCP configuration" }))

    expect(
      await screen.findByRole("button", { name: "Copied: Hub MCP configuration" }),
    ).toBeVisible()
    expect(writeText).toHaveBeenCalledWith(config.textContent)
  })

  it("requires confirmation and revokes only the selected agent connection", () => {
    const data: AgentConnectionsPrototypeData = {
      repositoryId: "2001",
      repositoryName: "github/prototype",
      hubUrl: "https://hub.example.com",
      signedInAs: "@octocat",
      view: "connections",
      connections: [
        {
          id: "agent-vscode",
          name: "Visual Studio Code",
          connectedAt: "2026-11-18",
          lastUsedAt: "2026-11-24",
        },
        {
          id: "agent-local",
          name: "Local MCP client",
          connectedAt: "2026-11-12",
          lastUsedAt: "2026-11-21",
        },
      ],
    }
    renderPrototype(data)

    fireEvent.click(screen.getByRole("button", { name: "Revoke Visual Studio Code access" }))
    const dialog = screen.getByRole("dialog", { name: "Revoke agent access?" })
    expect(dialog).toHaveTextContent("does not sign you out of Hub")
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeVisible()

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke access" }))

    expect(screen.queryByText("Visual Studio Code")).not.toBeInTheDocument()
    expect(screen.getByText("Local MCP client")).toBeVisible()
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent(
      "Visual Studio Code can no longer access Hub.",
    )
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Your connected agents" }),
    )
  })

  it("keeps agent access pending until approval and separates screenshot consent", () => {
    const data: AgentConnectionsPrototypeData = {
      repositoryId: "2001",
      repositoryName: "github/prototype",
      hubUrl: "https://hub.example.com",
      signedInAs: "@octocat",
      view: "approval",
      requestingAgent: "Visual Studio Code",
      connections: [],
    }
    renderPrototype(data)

    expect(screen.getByText(/does not allow session-message storage/)).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Agent connected" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Approve access" }))

    expect(screen.getByRole("heading", { name: "Agent connected" })).toBeVisible()
    expect(screen.getByText(/revoke its Hub access at any time/)).toBeVisible()
  })

  it("does not connect the agent when the person cancels approval", () => {
    const data: AgentConnectionsPrototypeData = {
      repositoryId: "2001",
      repositoryName: "github/prototype",
      hubUrl: "https://hub.example.com",
      signedInAs: "@octocat",
      view: "approval",
      requestingAgent: "Visual Studio Code",
      connections: [],
    }
    renderPrototype(data)

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.getByRole("heading", { name: "Connection cancelled" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Agent connected" })).not.toBeInTheDocument()
    expect(screen.getByText(/No Hub access was granted/)).toBeVisible()
  })
})
