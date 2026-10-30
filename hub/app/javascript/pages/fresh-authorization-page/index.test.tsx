import { ThemeProvider } from "@primer/react-brand/esm"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { FreshAuthorizationPage } from "."

describe("FreshAuthorizationPage()", () => {
  it("keeps an administrator check in Hub scope", () => {
    render(
      <ThemeProvider>
        <FreshAuthorizationPage
          data={{
            productName: "Replica Hub",
            pageTitle: "Fresh authorization",
            heading: "Fresh authorization",
            description: "Verify your GitHub account.",
            submitLabel: "Verify with GitHub",
            submitPath: "/authorization/example",
            cancelLabel: "Cancel",
            cancelPath: "/authorization/example",
            authenticityToken: "csrf-token",
            administrationWorkspace: hubAdministrationWorkspaceData,
          }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("navigation", { name: "Security and settings" })).toContainElement(
      screen.getByRole("link", { name: "Hub administrators" }),
    )
    expect(screen.getByRole("link", { name: "Hub administrators" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(
      screen.getByRole("button", { name: "Verify with GitHub" }).closest("form"),
    ).toHaveAttribute("action", "/authorization/example")
    expect(screen.getByRole("button", { name: "Cancel" }).closest("form")).toHaveAttribute(
      "action",
      "/authorization/example",
    )
  })

  it("starts or cancels authorization through protected forms without an original payload", () => {
    const { container } = render(
      <ThemeProvider>
        <FreshAuthorizationPage
          data={{
            productName: "Replica Hub",
            pageTitle: "Fresh authorization",
            heading: "Fresh authorization",
            description: "Verify the same GitHub account.",
            submitLabel: "Verify with GitHub",
            submitPath: "/authorization/example",
            cancelLabel: "Cancel",
            cancelPath: "/authorization/example",
            authenticityToken: "csrf-token",
          }}
        />
      </ThemeProvider>,
    )
    const verify = screen.getByRole("button", { name: "Verify with GitHub" }).closest("form")
    const cancel = screen.getByRole("button", { name: "Cancel" }).closest("form")
    expect(verify).toHaveAttribute("method", "post")
    expect(verify).toHaveAttribute("action", "/authorization/example")
    expect(verify?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(cancel).toHaveAttribute("action", "/authorization/example")
    expect(cancel?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(container.querySelector('input[name="user_id"]')).toBeNull()
    expect(container.querySelector('input[name="destination"]')).toBeNull()
    expect(container.querySelector('input[name="share_link"]')).toBeNull()
  })
})
