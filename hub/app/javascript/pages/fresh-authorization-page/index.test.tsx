import { ThemeProvider } from "@primer/react-brand"
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

  it("continues through the original route with only CSRF and an opaque authorization identifier", () => {
    render(
      <ThemeProvider>
        <FreshAuthorizationPage
          data={{
            productName: "Replica Hub",
            pageTitle: "Continue action",
            heading: "GitHub account verified",
            description: "Continuing your action.",
            submitLabel: "Continue",
            submitPath: "/github_app/credentials",
            authenticityToken: "csrf-token",
            continuation: { id: "opaque-authorization-id", method: "patch" },
          }}
        />
      </ThemeProvider>,
    )
    const form = screen.getByRole("button", { name: "Continue" }).closest("form")
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/github_app/credentials")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(form?.querySelector('input[name="authorization_continuation_id"]')).toHaveValue(
      "opaque-authorization-id",
    )
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("patch")
    expect(
      Array.from(form!.querySelectorAll("input"))
        .map((input) => input.name)
        .sort(),
    ).toEqual(["_method", "authenticity_token", "authorization_continuation_id"].sort())
  })
})
