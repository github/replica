import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CurrentSessionPage } from "."

describe("CurrentSessionPage()", () => {
  it("shows the admitted role and posts sign-out without exposing session data", () => {
    render(
      <ThemeProvider>
        <CurrentSessionPage
          data={{
            heading: "Signed in",
            description: "Current membership is active.",
            roleLabel: "Administrator",
            signOutLabel: "Sign out",
            signOutPath: "/api/auth/session/sign-out",
          }}
        />
      </ThemeProvider>,
    )

    expect(screen.getByText("Administrator")).toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/api/auth/session/sign-out")
    expect(form?.querySelector("input")).toBeNull()
  })
})
