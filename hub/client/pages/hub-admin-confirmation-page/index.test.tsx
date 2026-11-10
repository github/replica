import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { hubAdministrationData } from "@/storybook/fixtures/hub-administration"

import { HubAdminConfirmationPage } from "."
import type { HubAdminConfirmationPageData } from "./types"

const data: HubAdminConfirmationPageData = {
  ...hubAdministrationData,
  pageTitle: "Designate Hub administrator?",
  target: {
    membershipId: "22222222-2222-4222-8222-222222222222",
    login: "mona",
    name: "Mona Lisa",
    identity: "GitHub account",
  },
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
    expect(screen.getByText(`Membership ${data.target.membershipId}`)).toBeInTheDocument()
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

  it("submits a UUID target to the native provider authorization endpoint", () => {
    const membershipId = "22222222-2222-4222-8222-222222222222"
    render(
      <ThemeProvider>
        <HubAdminConfirmationPage
          data={{
            ...data,
            operation: "REVOKE_ADMINISTRATOR",
            targetMembershipId: membershipId,
            submitPath: "/api/administrators/authorizations/start",
            cancelPath: "/settings/administrators",
          }}
        />
      </ThemeProvider>,
    )

    const form = screen.getByRole("button", { name: data.submitLabel }).closest("form")
    expect(form).toHaveAttribute("action", "/api/administrators/authorizations/start")
    expect(form?.querySelector('[name="operation"]')).toHaveValue("REVOKE_ADMINISTRATOR")
    expect(form?.querySelector('[name="targetMembershipIds"]')).toHaveValue(membershipId)
    expect(form?.querySelector('[name="_method"]')).toBeNull()
    expect(form?.querySelector('[name="authenticity_token"]')).toBeNull()
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/settings/administrators",
    )
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
