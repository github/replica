import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubAdminEnrollmentPage } from "."

describe("HubAdminEnrollmentPage()", () => {
  it("submits only the protected bootstrap flow rather than a user identity or role", () => {
    render(
      <ThemeProvider>
        <HubAdminEnrollmentPage
          data={{
            alert: null,
            productName: "Replica Hub",
            pageTitle: "Enroll an administrator",
            heading: "Enroll an administrator",
            description: "Verify your own GitHub account.",
            secretLabel: "Bootstrap secret",
            providerActions: [
              {
                label: "Verify with GitHub",
                path: "/api/auth/github/admin-enrollment/start",
                provider: "github",
              },
              {
                label: "Verify with Microsoft Entra",
                path: "/api/auth/entra/admin-enrollment/start",
                provider: "entra",
              },
            ],
          }}
        />
      </ThemeProvider>,
    )
    const form = screen.getByRole("button", { name: "Verify with GitHub" }).closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(screen.getByRole("button", { name: "Verify with GitHub" })).toHaveAttribute(
      "formaction",
      "/api/auth/github/admin-enrollment/start",
    )
    expect(screen.getByRole("button", { name: "Verify with Microsoft Entra" })).toHaveAttribute(
      "formaction",
      "/api/auth/entra/admin-enrollment/start",
    )
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveAttribute("type", "password")
    expect(form?.querySelector('input[name="authenticity_token"]')).toBeNull()
    expect(form?.querySelector('input[name="user_id"]')).toBeNull()
  })

  it("preserves the single-action settings enrollment contract", () => {
    render(
      <ThemeProvider>
        <HubAdminEnrollmentPage
          data={{
            alert: null,
            canContinue: false,
            productName: "Replica Hub",
            pageTitle: "Enroll an operator",
            heading: "Enroll an operator",
            description: "Verify your own GitHub account.",
            secretLabel: "Bootstrap secret",
            submitLabel: "Verify with GitHub",
            submitPath: "/settings/enroll",
          }}
        />
      </ThemeProvider>,
    )

    const submit = screen.getByRole("button", { name: "Verify with GitHub" })
    expect(submit).toBeDisabled()
    expect(submit.closest("form")).toHaveAttribute("action", "/settings/enroll")
  })
})
