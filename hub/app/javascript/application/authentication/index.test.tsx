import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AuthenticationApplication } from "."

function sessionResponse(
  authenticated: boolean,
  csrfToken: string,
  user?: { displayName: string; username: string; avatarUrl: null },
) {
  return new Response(
    JSON.stringify({
      authenticated,
      configured: true,
      csrfToken,
      user,
    }),
    { headers: { "Content-Type": "application/json" } },
  )
}

const administratorSession = {
  authenticated: true,
  configured: true,
  csrfToken: "csrf-token",
  user: {
    id: "administrator",
    provider: "github",
    username: "administrator",
    displayName: "Administrator",
    avatarUrl: null,
  },
  membership: {
    id: "administrator-membership",
    role: "administrator",
    status: "active",
  },
}

const administration = {
  memberships: {
    memberships: [],
    nextCursor: null,
  },
  invitations: {
    invitations: [
      {
        id: "invitation",
        provider: "github",
        issuer: "https://github.com",
        subject: "42",
        role: "member",
        expiresAt: "2026-11-05T18:00:00.000Z",
        consumedAt: null,
        revokedAt: null,
      },
    ],
    nextCursor: null,
  },
}

function renderApplication(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetch)
  render(
    <ThemeProvider>
      <AuthenticationApplication />
    </ThemeProvider>,
  )
}

describe("AuthenticationApplication()", () => {
  it("shows a generic callback error and removes its query marker", async () => {
    window.history.replaceState({}, "", "/?authentication=failed")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sessionResponse(false, "csrf-token")))

    render(<AuthenticationApplication />)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub could not authorize this Hub session.",
    )
    expect(window.location.search).toBe("")
  })

  it("refreshes the CSRF token before starting sign-in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse(false, "initial-token"))
      .mockResolvedValueOnce(sessionResponse(false, "fresh-token"))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<AuthenticationApplication />)
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }))

    await screen.findByRole("alert")
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/auth/github", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": "fresh-token" },
    })
  })

  it("reconciles an already-ended session without sending sign-out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sessionResponse(true, "initial-token", {
          displayName: "Mona Lisa",
          username: "mona",
          avatarUrl: null,
        }),
      )
      .mockResolvedValueOnce(sessionResponse(false, "fresh-token"))
    vi.stubGlobal("fetch", fetchMock)
    render(<AuthenticationApplication />)
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeEnabled(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("loads and appends later membership and invitation pages from their cursors", async () => {
    const firstPage = {
      memberships: {
        memberships: [
          {
            id: "first-membership",
            status: "active",
            role: "member",
            user: {
              id: "first-user",
              displayName: "First member",
              externalIdentities: [],
            },
          },
        ],
        nextCursor: "membership-cursor",
      },
      invitations: {
        invitations: [
          {
            id: "first-invitation",
            provider: "github",
            issuer: "https://github.com",
            subject: "first-subject",
            role: "member",
            expiresAt: "2026-11-05T18:00:00.000Z",
            consumedAt: null,
            revokedAt: null,
          },
        ],
        nextCursor: "invitation-cursor",
      },
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(administratorSession))
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(
        Response.json({
          memberships: {
            memberships: [
              {
                id: "second-membership",
                status: "suspended",
                role: "member",
                user: {
                  id: "second-user",
                  displayName: "Second member",
                  externalIdentities: [],
                },
              },
            ],
            nextCursor: null,
          },
          invitations: firstPage.invitations,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          memberships: firstPage.memberships,
          invitations: {
            invitations: [
              {
                id: "second-invitation",
                provider: "github",
                issuer: "https://github.com",
                subject: "second-subject",
                role: "member",
                expiresAt: "2026-11-06T18:00:00.000Z",
                consumedAt: null,
                revokedAt: null,
              },
            ],
            nextCursor: null,
          },
        }),
      )
    renderApplication(fetch)

    fireEvent.click(await screen.findByRole("button", { name: "Load more memberships" }))
    expect(await screen.findByText("Second member")).toBeInTheDocument()
    expect(screen.getByText("First member")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith("/api/administration?membershipsCursor=membership-cursor", {
      credentials: "same-origin",
    })

    fireEvent.click(screen.getByRole("button", { name: "Load more invitations" }))
    expect(await screen.findByText("second-subject")).toBeInTheDocument()
    expect(screen.getByText("first-subject")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith("/api/administration?invitationsCursor=invitation-cursor", {
      credentials: "same-origin",
    })
    expect(
      screen.queryByRole("button", { name: /^Load more (memberships|invitations)$/ }),
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      name: "an expired session",
      status: 401,
      error: "sign_in_required",
      message: "Sign in to continue.",
    },
    {
      name: "lost administrator access",
      status: 403,
      error: "administrator_required",
      message: "Administrator access is required.",
    },
  ])("removes stale controls when loading more detects $name", async (failure) => {
    const firstPage = {
      memberships: {
        memberships: [],
        nextCursor: "membership-cursor",
      },
      invitations: {
        invitations: [],
        nextCursor: null,
      },
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(administratorSession))
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(
        Response.json(
          { error: failure.error, message: failure.message },
          { status: failure.status },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: false,
          configured: true,
          csrfToken: "replacement-csrf-token",
        }),
      )
    renderApplication(fetch)

    fireEvent.click(await screen.findByRole("button", { name: "Load more memberships" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(failure.message)
    expect(screen.queryByRole("heading", { name: "Hub membership" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load more memberships" })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith("/api/session", { credentials: "same-origin" })
  })

  it("starts same-identity verification when an administration mutation needs fresh authorization", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(administratorSession))
      .mockResolvedValueOnce(Response.json(administration))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: "fresh_authorization_required",
            message: "Verify your identity again.",
          },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ authorizationUrl: "https://github.example/verify" }))
    renderApplication(fetch)

    fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation" }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/session/verify",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          headers: { "X-CSRF-Token": "csrf-token" },
        }),
      ),
    )
    expect(screen.queryByText("fresh_authorization_required")).not.toBeInTheDocument()
  })

  it("shows the server-readable message for other administration failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(administratorSession))
      .mockResolvedValueOnce(Response.json(administration))
      .mockResolvedValueOnce(
        Response.json(
          {
            error: "invitation_changed",
            message: "The invitation is no longer available.",
          },
          { status: 409 },
        ),
      )
    renderApplication(fetch)

    fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The invitation is no longer available.",
    )
    expect(screen.getByRole("alert")).not.toHaveTextContent("invitation_changed")
  })

  it.each([
    {
      name: "an expired session",
      status: 401,
      error: "sign_in_required",
      message: "Sign in to continue.",
    },
    {
      name: "lost administrator access",
      status: 403,
      error: "administrator_required",
      message: "Administrator access is required.",
    },
  ])("reloads session state and removes stale controls after $name", async (failure) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(administratorSession))
      .mockResolvedValueOnce(Response.json(administration))
      .mockResolvedValueOnce(
        Response.json(
          { error: failure.error, message: failure.message },
          { status: failure.status },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: false,
          configured: true,
          csrfToken: "replacement-csrf-token",
        }),
      )
    renderApplication(fetch)

    fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(failure.message)
    expect(screen.queryByRole("heading", { name: "Hub membership" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Revoke invitation" })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith("/api/session", { credentials: "same-origin" })
  })
})
