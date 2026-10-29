import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MembershipAdministrationPage } from "."

describe("MembershipAdministrationPage()", () => {
  it("lets an administrator sign in again", () => {
    const onSignIn = vi.fn()
    render(
      <ThemeProvider>
        <MembershipAdministrationPage
          memberships={[]}
          invitations={[]}
          loading={false}
          error={null}
          onInvite={vi.fn()}
          onChange={vi.fn()}
          onRevokeInvitation={vi.fn()}
          onSignIn={onSignIn}
          onSignOut={vi.fn()}
        />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }))

    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it("offers restoration for suspension but no lifecycle actions after removal", () => {
    const onChange = vi.fn()
    render(
      <ThemeProvider>
        <MembershipAdministrationPage
          memberships={[
            {
              id: "suspended",
              status: "suspended",
              role: "member",
              user: {
                id: "suspended-user",
                displayName: "Suspended member",
                externalIdentities: [],
              },
            },
            {
              id: "removed",
              status: "removed",
              role: "administrator",
              user: {
                id: "removed-user",
                displayName: "Removed administrator",
                externalIdentities: [],
              },
            },
          ]}
          invitations={[]}
          loading={false}
          error={null}
          onInvite={vi.fn()}
          onChange={onChange}
          onRevokeInvitation={vi.fn()}
          onSignIn={vi.fn()}
          onSignOut={vi.fn()}
        />
      </ThemeProvider>,
    )

    const suspended = screen.getByText("Suspended member").closest("li")!
    fireEvent.click(within(suspended).getByRole("button", { name: "Restore" }))
    expect(onChange).toHaveBeenCalledWith("suspended", { status: "active" })

    const removed = screen.getByText("Removed administrator").closest("li")!
    expect(within(removed).queryByRole("button")).not.toBeInTheDocument()
  })
})
