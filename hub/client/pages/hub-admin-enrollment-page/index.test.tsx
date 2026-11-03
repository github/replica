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
            productName: "Replica Hub",
            pageTitle: "Enroll an operator",
            heading: "Enroll an operator",
            description: "Verify your own GitHub account.",
            secretLabel: "Bootstrap secret",
            submitLabel: "Verify with GitHub",
            submitPath: "/operator/enrollment",
            authenticityToken: "csrf-token",
          }}
        />
      </ThemeProvider>,
    )
    const form = screen.getByRole("button", { name: "Verify with GitHub" }).closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/operator/enrollment")
    expect(screen.getByLabelText(/Bootstrap secret/)).toHaveAttribute("type", "password")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(form?.querySelector('input[name="user_id"]')).toBeNull()
  })
})
