import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { MembershipAdministrationPage } from "."

describe("MembershipAdministrationPage()", () => {
  it("defaults new invitations to the member role", () => {
    const onInvite = vi.fn()
    render(
      <ThemeProvider>
        <MembershipAdministrationPage
          memberships={[]}
          invitations={[]}
          hasMoreMemberships={false}
          hasMoreInvitations={false}
          loading={false}
          error={null}
          onInvite={onInvite}
          onChange={vi.fn()}
          onRevokeInvitation={vi.fn()}
          onLoadMoreMemberships={vi.fn()}
          onLoadMoreInvitations={vi.fn()}
          onSignOut={vi.fn()}
        />
      </ThemeProvider>,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "Immutable subject" }), {
      target: { value: "42" },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Create invitation" }).closest("form")!)

    expect(onInvite).toHaveBeenCalledWith({
      provider: "github",
      issuer: "https://github.com",
      subject: "42",
      role: "member",
    })
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
          hasMoreMemberships={false}
          hasMoreInvitations={false}
          loading={false}
          error={null}
          onInvite={vi.fn()}
          onChange={onChange}
          onRevokeInvitation={vi.fn()}
          onLoadMoreMemberships={vi.fn()}
          onLoadMoreInvitations={vi.fn()}
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
