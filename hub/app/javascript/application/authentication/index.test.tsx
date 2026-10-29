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
})
