import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { SecurityAuditPage } from "."
import type { SecurityAuditPageData } from "./types"

const data: SecurityAuditPageData = {
  pageTitle: "Security audit",
  heading: "Security audit",
  description: "Deployment actions",
  notice: null,
  scopeLabel: "Audit scope",
  selectedScopeId: "hub",
  scopes: [{ id: "hub", label: "Hub", path: "/security_audit" }],
  retention: "Kept for 90 days. Security acceptance is pending.",
  emptyLabel: "No retained security actions.",
  nextLabel: "Older actions",
  nextPath: null,
  repositoriesLabel: "Repositories",
  repositoriesPath: "/repositories",
  signOutLabel: "Sign out",
  signOutPath: "/session",
  authenticityToken: "csrf-token",
  columns: {
    time: "Time",
    action: "Action",
    actor: "Actor",
    ip: "IP",
    context: "Context",
    outcome: "Outcome",
  },
  events: [],
}

describe("SecurityAuditPage()", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it("links only server-authorized scopes without carrying a pagination cursor across scopes", () => {
    render(
      <SecurityAuditPage
        data={{
          ...data,
          scopes: [
            ...data.scopes,
            { id: "2001", label: "github/prototype", path: "/repositories/2001/security_audit" },
          ],
          nextPath: "/security_audit?before=1",
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Audit scope" }))
    expect(screen.getByRole("menuitem", { name: "Hub" })).toHaveAttribute("aria-current", "page")
    expect(
      screen.getByRole("menuitem", { name: "github/prototype" }).querySelector("a"),
    ).toHaveAttribute("href", "/repositories/2001/security_audit")
    expect(screen.queryByRole("menuitem", { name: /all repositories/i })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Older actions" })).toHaveAttribute(
      "href",
      "/security_audit?before=1",
    )
  })

  it("links deployment administrators to the session cutoff confirmation", () => {
    render(
      <ThemeProvider>
        <SecurityAuditPage
          data={{
            ...data,
            administrationWorkspace: {
              ...hubAdministrationWorkspaceData,
              selectedSection: "audit",
            },
            sessionRevocationLabel: "End all Hub sessions",
            sessionRevocationPath: "/session_revocation",
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("link", { name: "End all Hub sessions" })).toHaveAttribute(
      "href",
      "/session_revocation",
    )
  })

  it("links deployment administrators to role management", () => {
    render(
      <ThemeProvider>
        <SecurityAuditPage
          data={{
            ...data,
            administrationWorkspace: {
              ...hubAdministrationWorkspaceData,
              selectedSection: "audit",
            },
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("link", { name: "Hub administrators" })).toHaveAttribute(
      "href",
      "/hub_admins",
    )
  })

  it("explains an empty retained scope without offering export or role changes", () => {
    render(
      <ThemeProvider>
        <SecurityAuditPage data={data} />
      </ThemeProvider>,
    )
    expect(screen.getByText(data.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /export|grant|revoke/i })).not.toBeInTheDocument()
  })

  it("renders the anonymous actor and older-page link without interpreting action text as HTML", () => {
    render(
      <ThemeProvider>
        <SecurityAuditPage
          data={{
            ...data,
            nextPath: "/security_audit?before=1",
            events: [
              {
                id: 1,
                time: "2026-10-05T19:00:00Z",
                action: "<script>unsafe</script>",
                actor: "No signed-in actor",
                ip: "203.0.113.12",
                context: '{"source":"browser"}',
                outcome: "Denied",
              },
            ],
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("table")).toHaveTextContent("No signed-in actor")
    expect(screen.getByRole("region", { name: "Security audit" })).toHaveAttribute("tabindex", "0")
    expect(screen.getByText("<script>unsafe</script>")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Older actions" })).toHaveAttribute(
      "href",
      "/security_audit?before=1",
    )
  })

  it("shows the verification result on the operator's existing return page", () => {
    const notice =
      "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes."
    render(
      <ThemeProvider>
        <SecurityAuditPage data={{ ...data, notice }} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent(notice)
    expect(screen.queryByRole("button", { name: /grant|revoke/i })).not.toBeInTheDocument()
  })
})
