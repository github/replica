import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { HubApplication } from "."

function renderApplication() {
  return render(
    <HubThemeProvider>
      <HubApplication />
    </HubThemeProvider>,
  )
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : input.toString()
}

describe("HubApplication()", () => {
  it("shows loading until current-session restoration finishes", async () => {
    let resolveResponse!: (response: Response) => void
    const request = vi.fn((input: RequestInfo | URL) =>
      requestUrl(input).endsWith("/api/auth/providers")
        ? Promise.resolve(Response.json({ providers: ["github"] }))
        : new Promise<Response>((resolve) => {
            resolveResponse = resolve
          }),
    )
    vi.stubGlobal("fetch", request)

    renderApplication()

    expect(screen.getByText("Checking your Hub session…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    expect(requestUrl(request.mock.calls[0]![0])).toBe("/api/auth/providers")

    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf("function"))
    resolveResponse(new Response(null, { status: 401 }))
    expect(
      await screen.findByText("Sign in with an active Replica Hub membership."),
    ).toBeInTheDocument()
  })

  it("shows callback success only after restoring the admitted session", async () => {
    window.history.replaceState({}, "", "/?authentication=success")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? Response.json({ providers: ["github", "entra"] })
            : Response.json({ authenticated: true, role: "ADMINISTRATOR" }),
        ),
      ),
    )

    renderApplication()

    expect(await screen.findByText("Signed in to Replica Hub")).toBeInTheDocument()
    expect(
      screen.getByText("Sign-in succeeded and Replica Hub restored your active session."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull()
  })

  it("shows a restore error without a false callback success notice", async () => {
    window.history.replaceState({}, "", "/?authentication=success")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? Response.json({ providers: ["github"] })
            : new Response(null, { status: 401 }),
        ),
      ),
    )

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not restore your session. Sign in again to continue.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
    expect(
      screen.queryByText("Sign-in succeeded and Replica Hub restored your active session."),
    ).toBeNull()
  })

  it.each([401, 404])(
    "shows the ordinary signed-out state without a restore error for %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) =>
          Promise.resolve(
            requestUrl(input).endsWith("/api/auth/providers")
              ? Response.json({ providers: ["github"] })
              : new Response(null, { status }),
          ),
        ),
      )

      renderApplication()

      expect(
        await screen.findByText("Sign in with an active Replica Hub membership."),
      ).toBeInTheDocument()
      expect(screen.queryByText(/could not restore your session/i)).toBeNull()
    },
  )

  it.each([
    ["server failure", new Response(null, { status: 500 })],
    ["invalid success response", Response.json({ authenticated: false })],
  ])("shows a restore error for %s", async (_description, response) => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? Response.json({ providers: ["github"] })
            : response,
        ),
      ),
    )

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not restore your session. Sign in again to continue.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
  })

  it("shows only explicitly configured sign-in providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? Response.json({ providers: ["entra"] })
            : new Response(null, { status: 401 }),
        ),
      ),
    )

    renderApplication()

    expect(
      await screen.findByRole("button", { name: "Sign in with Microsoft Entra" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull()
  })

  it("shows an explicit discovery failure with no fallback actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? new Response(null, { status: 500 })
            : new Response(null, { status: 401 }),
        ),
      ),
    )

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not load sign-in options. Reload the page to try again.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /sign in with/i })).toBeNull()
  })

  it("shows provider discovery failure on administrator enrollment for a signed-in session", async () => {
    window.history.replaceState({}, "", "/admin-enrollment")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          requestUrl(input).endsWith("/api/auth/providers")
            ? new Response(null, { status: 500 })
            : Response.json({ authenticated: true, role: "ADMINISTRATOR" }),
        ),
      ),
    )

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not load sign-in options. Reload the page to try again.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /verify with/i })).toBeNull()
  })
})
