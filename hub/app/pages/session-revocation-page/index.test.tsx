import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { SessionRevocationPage } from "."
import { sessionRevocationData as data } from "./stories"

describe("SessionRevocationPage()", () => {
  it("requires deliberate confirmation and makes the operator's own sign-out explicit", () => {
    render(
      <ThemeProvider>
        <SessionRevocationPage data={data} />
      </ThemeProvider>,
    )
    expect(screen.getByText(data.ownSession!)).toBeInTheDocument()
    expect(screen.getByText(data.scope)).toBeInTheDocument()
    const checkbox = screen.getByRole("checkbox", { name: data.confirmLabel })
    expect(checkbox).toBeRequired()
    expect(checkbox).not.toBeChecked()
    const form = checkbox.closest("form")!
    expect(form).toHaveAttribute("action", "/session_revocation")
    expect(form).toHaveAttribute("method", "post")
    expect(form.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(form.checkValidity()).toBe(false)
    fireEvent.click(checkbox)
    expect(form.checkValidity()).toBe(true)
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("formnovalidate")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("name", "cancelled")
  })

  it("shows a result without signed-in navigation or another destructive form", () => {
    render(
      <ThemeProvider>
        <SessionRevocationPage
          data={{
            ...data,
            authenticatedWorkspace: authenticatedHubWorkspaceData,
            signedOut: true,
            canRevoke: false,
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("link", { name: data.signInLabel })).toHaveAttribute("href", "/")
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("shows a denial without revealing credential counts or allowing submission", () => {
    render(
      <ThemeProvider>
        <SessionRevocationPage
          data={{
            ...data,
            administrationWorkspace: null,
            canRevoke: false,
            counts: null,
            alert: "Not authorized.",
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Not authorized.")
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText(data.counts!)).toBeNull()
  })

  it("keeps partial disconnect failure distinct from credential revocation", () => {
    render(
      <ThemeProvider>
        <SessionRevocationPage
          data={{
            ...data,
            canRevoke: false,
            signedOut: true,
            alert: "Credentials were revoked, but live disconnect delivery failed.",
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Credentials were revoked")
    expect(screen.getByRole("link", { name: data.signInLabel })).toBeInTheDocument()
  })
})
