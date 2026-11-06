import { act, screen, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub route feedback", () => {
  it("announces a pending route until its content loads and then focuses the new main content", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    let finishLoad: (() => void) | undefined
    const loading = new Promise<void>((resolve) => {
      finishLoad = resolve
    })
    onTestFinished(() => finishLoad?.())
    const historyRequested = vi.fn()
    server.use(
      http.get(`${store.origin}/api/repositories/2001/prototypes/1/builds`, async () => {
        historyRequested()
        await loading
        return HttpResponse.json(store.getBuildHistory(2001, 1))
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001")
    expect(screen.queryByRole("status", { name: "Page loading" })).not.toBeInTheDocument()

    act(() => {
      void router.navigate("/repositories/2001/prototypes/1/builds")
    })
    await waitFor(() => expect(historyRequested).toHaveBeenCalledOnce())

    const loadingStatus = screen.getByRole("status", { name: "Page loading" })
    const busySurface = loadingStatus.closest("[aria-busy]")
    expect(busySurface).toHaveAttribute("aria-busy", "true")
    expect(router.state.navigation.state).toBe("loading")
    expect(screen.queryByRole("heading", { name: "History", level: 2 })).not.toBeInTheDocument()

    if (!finishLoad) throw new Error("The pending route must expose its completion.")
    finishLoad()
    await router.settle()

    expect(screen.getByRole("heading", { name: "History", level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Page loading" })).not.toBeInTheDocument()
    expect(busySurface).toHaveAttribute("aria-busy", "false")
    expect(screen.getByRole("main")).toHaveFocus()
  })
})
