import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SharingSettingsPage } from "."
import story, { AccessRemoved } from "./stories"

describe("SharingSettingsPage()", () => {
  it("requires explicit confirmation and submits only the operation and browser CSRF proof", () => {
    const data = story.args.data
    render(
      <ThemeProvider>
        <SharingSettingsPage data={data} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("heading", { name: data.statusLabel })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: data.confirmLabel })).toBeRequired()
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    const form = screen.getByRole("button", { name: data.submitLabel }).closest("form")
    expect(form).toHaveAttribute("action", "/sharing_settings")
    expect(form?.querySelector('[name="_method"]')).toHaveValue("patch")
    expect(form?.querySelector('[name="operation"]')).toHaveValue("enable")
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(form?.querySelector('[name="user_id"]')).toBeNull()
    expect(screen.getByText(data.verification)).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Previously revoked links stay revoked")
  })

  it("keeps independent repository permissions after Hub access is removed", () => {
    const data = AccessRemoved.args!.data!
    render(
      <ThemeProvider>
        <SharingSettingsPage data={data} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("navigation", { name: "Hub navigation" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      "/repositories/2001",
    )
    expect(screen.getByRole("button", { name: "Account menu for @octocat" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Hub administration" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Hub administrators" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "GitHub App" })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: story.args.data.submitLabel }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Security audit" })).toHaveAttribute(
      "href",
      "/repositories/2001/security_audit",
    )
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
      "href",
      "/repositories/2001/analytics",
    )
  })
})
