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
            submitLabel: "Verify with GitHub",
            submitPath: "/api/auth/github/admin-enrollment/start",
          }}
        />
      </ThemeProvider>,
    )
    const form = screen.getByRole("button", { name: "Verify with GitHub" }).closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/api/auth/github/admin-enrollment/start")
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveAttribute("type", "password")
    expect(form?.querySelector('input[name="authenticity_token"]')).toBeNull()
    expect(form?.querySelector('input[name="user_id"]')).toBeNull()
  })
})
