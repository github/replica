import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub mock session flow", () => {
  // The complete sign-in/redirect/sign-out flow exceeded 5s with two Windows workers.
  it("opens signed-out sign-in without a workspace and signs in and out through the retained controls", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const workspaceReads = vi.fn(() =>
      HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
    )
    const server = setupServer(...createMockHandlers(store))
    server.use(http.get(`${store.origin}/api/workspace`, workspaceReads))
    const router = await renderHubFlow(server, "/sign-in")

    const signIn = await screen.findByRole("button", { name: "Sign in with GitHub" })
    expect(
      screen.getByRole("heading", { name: "Build and review prototypes with your team." }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Replica Hub turns GitHub branches into shareable prototypes where your team can review changes and leave feedback.",
      ),
    ).toBeInTheDocument()
    expect(workspaceReads).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()

    server.resetHandlers()
    await router.settle(() => fireEvent.click(signIn))

    expect(
      within(await screen.findByRole("region", { name: "Prototypes" })).getByRole("link", {
        name: "Welcome",
      }),
    ).toBeInTheDocument()
    expect(store.session.read()).toMatchObject({
      profile: "owner",
      viewer: { login: "octocat" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })))

    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/sign-in")
    expect(store.session.read().viewer).toBeNull()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  }, 10_000)

  it("redirects a signed-out private destination instead of rendering another viewer's workspace", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const server = setupServer(...createMockHandlers(store))

    const router = await renderHubFlow(server, "/repositories/2001")

    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/sign-in")
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  })

  it("clears a private editor on sign-out and does not restore its abandoned draft after sign-in", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const originalDialog = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(originalDialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Only the previous session's draft" },
    })
    const signOut = new FormData()
    signOut.set("intent", "sign-out")
    await router.settle(() =>
      router.navigate("/session", {
        formMethod: "post",
        formData: signOut,
      }),
    )
    expect(originalDialog).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeVisible()
    expect(store.session.read().viewer).toBeNull()
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" })),
    )
    await router.settle(() => router.navigate("/repositories/2001/prototypes/1"))

    expect(store.session.read().viewer?.login).toBe("octocat")
    expect(router.state.location.pathname).toBe("/repositories/2001/prototypes/1")
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Name" })).toHaveValue(
      "Welcome",
    )
  })

  it("keeps Mona read-only even on the prototype she authored", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))

    await renderHubFlow(server, "/repositories/2001/prototypes/2")

    expect(await screen.findByRole("button", { name: "Account menu for @mona" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Branch from here" })).not.toBeInTheDocument()
    const response = await fetch(`${store.origin}/api/repositories/2001/prototypes/2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Reader must not save", description: null }),
    })
    expect(response.status).toBe(403)
    expect(store.getPrototype(2001, 2).prototype.name).toBe("Navigation")
  })
})
