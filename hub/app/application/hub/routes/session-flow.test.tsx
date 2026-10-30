import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { renderHubFlow } from "./test-fixture"

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

    const signIn = await screen.findByRole("button", { name: "Mock sign in as Octocat" })
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

    expect(
      await screen.findByRole("button", { name: "Mock sign in as Octocat" }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/sign-in")
    expect(store.session.read().viewer).toBeNull()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  }, 10_000)

  it("redirects a signed-out private destination instead of rendering another viewer's workspace", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const server = setupServer(...createMockHandlers(store))

    const router = await renderHubFlow(server, "/repositories/2001")

    expect(
      await screen.findByRole("button", { name: "Mock sign in as Octocat" }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/sign-in")
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  })

  it("clears an unsaved editor when the session revision changes even for the same viewer", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const originalDialog = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(originalDialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Only the previous session's draft" },
    })
    const previousRevision = store.session.read().revision

    const response = await fetch(`${store.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "owner" }),
    })
    expect(response.status).toBe(200)
    await act(async () => router.revalidate())

    await waitFor(() => expect(originalDialog).not.toBeInTheDocument())
    expect(store.session.read()).toMatchObject({
      profile: "owner",
      revision: previousRevision + 1,
      viewer: { login: "octocat" },
    })
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
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument()
    const response = await fetch(`${store.origin}/api/repositories/2001/prototypes/2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Reader must not save", description: null }),
    })
    expect(response.status).toBe(403)
    expect(store.getPrototype(2001, 2).prototype.name).toBe("Navigation")
  })
})
