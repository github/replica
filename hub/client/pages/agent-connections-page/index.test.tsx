import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { AgentConnectionsPage } from "."

describe("AgentConnectionsPage()", () => {
  it("copies a repository MCP address without putting a credential in the config", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    render(
      <AgentConnectionsPage
        data={{
          view: "connections",
          repositoryName: "github/prototype",
          mcpUrl: "https://hub.example.com/mcp/repositories/2001",
          signedInAs: "octocat",
          notice: null,
          connections: [],
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    const config = screen.getByLabelText("Hub MCP configuration")
    expect(config).toHaveTextContent("https://hub.example.com/mcp/repositories/2001")
    expect(config).not.toHaveTextContent(/token|secret|password/i)
    fireEvent.click(screen.getByRole("button", { name: "Copy: Hub MCP configuration" }))

    expect(
      await screen.findByRole("button", { name: "Copied: Hub MCP configuration" }),
    ).toBeVisible()
    expect(writeText).toHaveBeenCalledWith(config.textContent)
  })

  it("asks for confirmation before revoking only the chosen agent", () => {
    render(
      <AgentConnectionsPage
        data={{
          view: "connections",
          repositoryName: "github/prototype",
          mcpUrl: "https://hub.example.com/mcp/repositories/2001",
          signedInAs: "octocat",
          notice: null,
          connections: [
            {
              id: "agent-vscode",
              name: "Visual Studio Code",
              connectedLabel: "Connected 11/18/2026",
              lastUsedLabel: "Last used 11/24/2026",
              revokePath: "/repositories/2001/learnings/agents/agent-vscode",
            },
            {
              id: "agent-local",
              name: "Local MCP client",
              connectedLabel: "Connected 11/12/2026",
              lastUsedLabel: "Not used yet",
              revokePath: "/repositories/2001/learnings/agents/agent-local",
            },
          ],
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    fireEvent.click(screen.getByRole("button", { name: "Revoke Local MCP client access" }))

    const dialog = screen.getByRole("dialog", { name: "Revoke agent access?" })
    const form = within(dialog).getByRole("button", { name: "Revoke access" }).closest("form")
    expect(form).toHaveAttribute("action", "/repositories/2001/learnings/agents/agent-local")
    expect(new FormData(form!).get("_method")).toBe("delete")
  })
})
