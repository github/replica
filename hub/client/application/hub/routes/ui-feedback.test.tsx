import { act, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub route feedback", () => {
  it("announces a pending route until its content loads and then focuses the new main content", async () => {
    const { path, galleryPath, repository, prototype } = previewRecords()
    let finishLoad: (() => void) | undefined
    const loading = new Promise<void>((resolve) => {
      finishLoad = resolve
    })
    onTestFinished(() => finishLoad?.())
    const historyRequested = vi.fn()
    const server = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${galleryPath}`, () =>
        Response.json({
          repository,
          prototypes: [prototype],
          authors: [],
          pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 1 },
        }),
      ),
      http.get(`/api${path}/builds`, async () => {
        historyRequested()
        await loading
        return Response.json({
          repository,
          prototype,
          builds: prototype.builds,
          pagination: { page: 1, pageSize: 25, pageCount: 1, totalCount: prototype.builds.length },
        })
      }),
    )
    const router = await renderHubFlow(server, galleryPath)
    expect(screen.queryByRole("status", { name: "Page loading" })).not.toBeInTheDocument()

    act(() => {
      void router.navigate(`${path}/builds`)
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
