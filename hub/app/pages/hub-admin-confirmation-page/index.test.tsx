import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { HubAdminConfirmationPage } from "."
import type { HubAdminConfirmationPageData } from "./types"

const data: HubAdminConfirmationPageData = {
  ...hubAdministrationData,
  pageTitle: "Designate Hub administrator?",
  target: { login: "mona", name: "Mona Lisa", identity: "GitHub identity 1002 - Hub user 2" },
  operation: "designate",
  submitPath: "/hub_admins/2",
  submitLabel: "Designate administrator",
  confirmLabel: "I confirm this Hub administrator role change.",
  cancelLabel: "Cancel",
  cancelPath: "/hub_admins",
  verification: "Verify with GitHub, then confirm again. Hub never replays the change.",
  blockedLabel: null,
}

describe("HubAdminConfirmationPage()", () => {
  it("requires deliberate confirmation and submits only the operation and CSRF proof", () => {
    render(
      <ThemeProvider>
        <HubAdminConfirmationPage data={data} />
      </ThemeProvider>,
    )
    expect(screen.getByText(data.target.identity)).toBeInTheDocument()
    const checkbox = screen.getByRole("checkbox", { name: data.confirmLabel })
    expect(checkbox).toBeRequired()
    expect(checkbox).not.toBeChecked()
    const form = screen.getByRole("button", { name: data.submitLabel }).closest("form")
    expect(form).toHaveAttribute("action", "/hub_admins/2")
    expect(form?.querySelector('[name="operation"]')).toHaveValue("designate")
    expect(form?.querySelector('[name="_method"]')).toHaveValue("patch")
    expect(form?.querySelector('[name="authenticity_token"]')).toHaveValue("storybook-token")
    expect(form?.querySelector('[name="user_id"]')).toBeNull()
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/hub_admins")
    expect(screen.getByText(data.verification)).toBeInTheDocument()
  })

  it("explains final administrator protection and disables removal", () => {
    render(
      <ThemeProvider>
        <HubAdminConfirmationPage
          data={{
            ...data,
            operation: "revoke",
            blockedLabel: "The final administrator cannot be removed.",
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The final administrator cannot be removed.",
    )
    expect(screen.getByRole("button", { name: data.submitLabel })).toBeDisabled()
    expect(screen.getByRole("checkbox")).toBeDisabled()
  })
})
