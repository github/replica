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

describe("HubApplication()", () => {
  it("shows loading until current-session restoration finishes", async () => {
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve
          }),
      ),
    )

    renderApplication()

    expect(screen.getByText("Checking your Hub session…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull()

    resolveResponse(new Response(null, { status: 401 }))
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
  })

  it("shows callback success only after restoring the admitted session", async () => {
    window.history.replaceState({}, "", "/?authentication=success")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ authenticated: true, role: "administrator" })),
    )

    renderApplication()

    expect(await screen.findByText("Signed in to Replica Hub")).toBeInTheDocument()
    expect(
      screen.getByText("GitHub sign-in succeeded and Replica Hub restored your active session."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull()
  })

  it("shows a restore error without a false callback success notice", async () => {
    window.history.replaceState({}, "", "/?authentication=success")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })))

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not restore your session. Sign in again to continue.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("GitHub sign-in succeeded and Replica Hub restored your active session."),
    ).toBeNull()
  })

  it.each([401, 404])(
    "shows the ordinary signed-out state without a restore error for %s",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })))

      renderApplication()

      expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
      expect(screen.queryByText(/could not restore your session/i)).toBeNull()
    },
  )

  it.each([
    ["server failure", new Response(null, { status: 500 })],
    ["invalid success response", Response.json({ authenticated: false })],
  ])("shows a restore error for %s", async (_description, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

    renderApplication()

    expect(
      await screen.findByText(
        "Replica Hub could not restore your session. Sign in again to continue.",
      ),
    ).toBeInTheDocument()
  })
})
