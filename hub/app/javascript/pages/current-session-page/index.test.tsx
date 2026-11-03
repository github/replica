import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import tokenStyles from "@/tokens/base.css?inline"
import { CurrentSessionPage } from "."
import currentSessionStyles from "./styles.css?inline"
import loadingStyles from "../session-loading-page/styles.css?inline"

describe("CurrentSessionPage()", () => {
  it("uses defined semantic canvas tokens for session surfaces", () => {
    const definitions = new Set(
      [...tokenStyles.matchAll(/(--hub-[a-z0-9-]+)\s*:/g)].map(([, token]) => token),
    )
    for (const styles of [currentSessionStyles, loadingStyles]) {
      for (const [, token] of styles.matchAll(/var\((--hub-[a-z0-9-]+)/g)) {
        expect(definitions.has(token)).toBe(true)
      }
    }
    expect(currentSessionStyles).toContain("background: var(--hub-canvas-subtle);")
    expect(currentSessionStyles).toContain("background: var(--hub-canvas-default);")
    expect(loadingStyles).toContain("background: var(--hub-canvas-default);")
  })

  it("shows the admitted role and posts sign-out without exposing session data", () => {
    render(
      <ThemeProvider>
        <CurrentSessionPage
          data={{
            heading: "Signed in",
            description: "Current membership is active.",
            notice: null,
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
