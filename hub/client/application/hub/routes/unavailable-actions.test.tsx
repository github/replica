import { fireEvent, screen, within } from "@testing-library/react"
import { setupServer } from "msw/node"
import { useLoaderData } from "react-router"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { mockBootstrapSecret } from "../mocks/create-settings-handlers"
import SettingsGithubSetupRoute, { clientLoader as loadSetup } from "./settings-github-setup"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function UnconnectedPreferences() {
  return (
    <main>
      <h1>Account preferences</h1>
      <form method="post" action="/unconnected-preferences">
        <label>
          Display name
          <input name="display_name" />
        </label>
        <button type="submit">Save preferences</button>
      </form>
      <a href="/repositories/2001">Return to repository</a>
    </main>
  )
}

function SetupComponent() {
  return <SettingsGithubSetupRoute loaderData={useLoaderData<typeof loadSetup>()} />
}

describe("Hub unavailable actions", () => {
  it("shows a dismissible failure for an unconnected native form without development tools or a mutation request", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const requests: Request[] = []
    server.events.on("request:start", ({ request }) => requests.push(request))
    const router = await renderHubFlow(server, "/unconnected-preferences", {
      workspaceRoutes: [{ path: "/unconnected-preferences", Component: UnconnectedPreferences }],
    })
    expect(
      screen.queryByRole("complementary", { name: "Frontend test controls" }),
    ).not.toBeInTheDocument()
    const name = screen.getByRole("textbox", { name: "Display name" })
    fireEvent.change(name, { target: { value: "Keep my preferences draft" } })

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" })),
    )

    expect(requests.filter(({ method }) => method !== "GET")).toEqual([])
    const failure = await screen.findByRole("alert")
    expect(failure).toBeVisible()
    expect(failure).not.toBeEmptyDOMElement()
    expect(failure).not.toHaveTextContent(/not connected|no request was sent/i)
    expect(name).toHaveValue("Keep my preferences draft")

    fireEvent.click(within(failure).getByRole("button", { name: /dismiss|close/i }))

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" })),
    )
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([])

    await router.settle(() =>
      fireEvent.click(screen.getByRole("link", { name: "Return to repository" })),
    )
    expect(screen.getByRole("region", { name: "Prototypes" })).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps setup locked after a rejected bootstrap secret without echoing it", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const server = setupServer(...createMockHandlers(store))
    const requests: Request[] = []
    server.events.on("request:start", ({ request }) => requests.push(request))
    await renderHubFlow(server, "/settings/github/setup", {
      publicRoutes: [
        { path: "/settings/github/setup", loader: loadSetup, Component: SetupComponent },
      ],
    })
    const secret = screen.getByLabelText(/Bootstrap secret/)
    fireEvent.change(secret, { target: { value: "synthetic-wrong-secret-for-test" } })

    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    const failure = await screen.findByRole("alert")
    expect(failure).toHaveTextContent("The bootstrap secret is incorrect.")
    expect(failure).not.toHaveTextContent("synthetic-wrong-secret-for-test")
    expect(secret).toHaveValue("synthetic-wrong-secret-for-test")
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([])

    fireEvent.change(secret, { target: { value: mockBootstrapSecret } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("heading", { name: "1. Register the GitHub App" })).toBeVisible()
  })
})
