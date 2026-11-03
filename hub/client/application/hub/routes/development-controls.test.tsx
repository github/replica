import { fireEvent, screen, within } from "@testing-library/react"
import { setupServer } from "msw/node"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { mockDiagnostics } from "../mocks/diagnostics"
import { renderHubFlow } from "./test-fixture"

function UnconnectedPreferences() {
  return (
    <main>
      <h1>Account preferences</h1>
      <form method="post" action="/unconnected-preferences">
        <button type="submit">Save preferences</button>
      </form>
    </main>
  )
}

describe("Hub development controls", () => {
  it("reports an unconnected action only in the toolbar without sending a mutation", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const requests: Request[] = []
    server.events.on("request:start", ({ request }) => requests.push(request))
    const router = await renderHubFlow(server, "/unconnected-preferences", {
      withTools: true,
      workspaceRoutes: [{ path: "/unconnected-preferences", Component: UnconnectedPreferences }],
    })

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" })),
    )

    const toolbar = screen.getByRole("complementary", { name: "Frontend test controls" })
    expect(await within(toolbar).findByText(/action is not connected/i)).toBeInTheDocument()
    expect(screen.getByRole("main")).not.toHaveTextContent(/not connected|no request was sent/i)
    expect(requests.some(({ url }) => new URL(url).pathname === "/api/workspace")).toBe(true)
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([])
  })

  it("keeps forced-failure diagnostics in the toolbar while the route receives and recovers from its HTTP failure", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const repositoryStatuses: number[] = []
    server.events.on("response:mocked", ({ request, response }) => {
      if (new URL(request.url).pathname === "/api/repositories/2001") {
        repositoryStatuses.push(response.status)
      }
    })
    const router = await renderHubFlow(server, "/repositories/2001", { withTools: true })
    expect(screen.getByRole("region", { name: "Prototypes" })).toBeVisible()

    await router.settle(() =>
      fireEvent.change(screen.getByRole("combobox", { name: "API scenario" }), {
        target: { value: "server-error" },
      }),
    )

    const toolbar = screen.getByRole("complementary", { name: "Frontend test controls" })
    expect(within(toolbar).getByRole("status")).toHaveTextContent(/server-error response selected/)
    expect(repositoryStatuses).toContain(500)
    expect(within(screen.getByRole("main")).getByRole("alert")).toBeVisible()
    expect(screen.getByRole("main")).not.toHaveTextContent(
      /server-error|response selected|local responses only|local data only/i,
    )

    await router.settle(() =>
      fireEvent.change(within(toolbar).getByRole("combobox", { name: "API scenario" }), {
        target: { value: "normal" },
      }),
    )

    expect(await screen.findByRole("region", { name: "Prototypes" })).toBeVisible()
    expect(repositoryStatuses.at(-1)).toBe(200)
  })
})
