import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AuthenticationApplication } from "."

describe("AuthenticationApplication()", () => {
  it("offers provider-role recovery through the configured sign-in flow", async () => {
    window.history.replaceState({}, "", "/?authentication=failed&reason=provider_role_changed")
    const authorizationUrl = "#provider-role-recovery"
    const session = {
      authenticated: true,
      configured: true,
      provider: "oidc",
      providerLabel: "Company SSO",
      csrfToken: "session-csrf-token",
      user: { id: "administrator", displayName: "Hub administrator" },
      membership: { id: "administrator-membership", role: "administrator", status: "active" },
    }
    const administration = { memberships: [], invitations: [] }
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/session" && init?.method === undefined) {
        return Promise.resolve(Response.json(session))
      }
      if (input === "/api/administration" && init?.method === undefined) {
        return Promise.resolve(Response.json(administration))
      }
      if (input === "/api/auth/oidc") {
        return Promise.resolve(Response.json({ authorizationUrl }))
      }
      return Promise.reject(new Error("Unexpected request"))
    })
    vi.stubGlobal("fetch", fetch)
    render(
      <ThemeProvider>
        <AuthenticationApplication />
      </ThemeProvider>,
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your provider role changed. Sign in again to update your Hub access.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }))

    await waitFor(() => expect(window.location.hash).toBe(authorizationUrl))
    expect(fetch).toHaveBeenCalledWith("/api/auth/oidc", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": "session-csrf-token" },
    })
  })

  it("starts fresh verification instead of presenting a failed administration mutation as success", async () => {
    const authorizationUrl = "#provider-authorization"
    const session = {
      authenticated: true,
      configured: true,
      provider: "github",
      providerLabel: "GitHub",
      csrfToken: "session-csrf-token",
      user: { id: "administrator", displayName: "Hub administrator" },
      membership: { id: "administrator-membership", role: "administrator", status: "active" },
    }
    const administration = {
      memberships: [
        {
          id: "member-membership",
          status: "active",
          role: "member",
          user: {
            id: "member",
            displayName: "Hub member",
            externalIdentities: [],
          },
        },
      ],
      invitations: [],
    }
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/session" && init?.method === undefined) {
        return Promise.resolve(Response.json(session))
      }
      if (input === "/api/administration" && init?.method === undefined) {
        return Promise.resolve(Response.json(administration))
      }
      if (input === "/api/administration/memberships/member-membership") {
        return Promise.resolve(
          Response.json(
            { error: "fresh_authorization_required", message: "Verify before continuing." },
            { status: 403 },
          ),
        )
      }
      if (input === "/api/session/verify") {
        return Promise.resolve(Response.json({ authorizationUrl }))
      }
      return Promise.reject(new Error("Unexpected request"))
    })
    vi.stubGlobal("fetch", fetch)
    render(
      <ThemeProvider>
        <AuthenticationApplication />
      </ThemeProvider>,
    )
    const member = (await screen.findByText("Hub member")).closest("li")!

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }))

    await waitFor(() => expect(window.location.hash).toBe(authorizationUrl))
    expect(fetch).toHaveBeenCalledWith("/api/session/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": "session-csrf-token" },
    })
    expect(member).toHaveTextContent("member · active")
    expect(fetch.mock.calls.filter(([input]) => input === "/api/session")).toHaveLength(1)
  })

  it("shows a useful error when fresh verification cannot start", async () => {
    const session = {
      authenticated: true,
      configured: true,
      provider: "github",
      providerLabel: "GitHub",
      csrfToken: "session-csrf-token",
      user: { id: "administrator", displayName: "Hub administrator" },
      membership: { id: "administrator-membership", role: "administrator", status: "active" },
    }
    const administration = {
      memberships: [
        {
          id: "member-membership",
          status: "active",
          role: "member",
          user: {
            id: "member",
            displayName: "Hub member",
            externalIdentities: [],
          },
        },
      ],
      invitations: [],
    }
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/session" && init?.method === undefined) {
        return Promise.resolve(Response.json(session))
      }
      if (input === "/api/administration" && init?.method === undefined) {
        return Promise.resolve(Response.json(administration))
      }
      if (input === "/api/administration/memberships/member-membership") {
        return Promise.resolve(
          Response.json({ error: "fresh_authorization_required" }, { status: 403 }),
        )
      }
      if (input === "/api/session/verify") {
        return Promise.resolve(Response.json({ error: "provider_unavailable" }, { status: 503 }))
      }
      return Promise.reject(new Error("Unexpected request"))
    })
    vi.stubGlobal("fetch", fetch)
    render(
      <ThemeProvider>
        <AuthenticationApplication />
      </ThemeProvider>,
    )
    await screen.findByText("Hub member")
    const currentUrl = window.location.href

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Hub could not start verification.")
    expect(window.location.href).toBe(currentUrl)
  })
})
