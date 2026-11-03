import { fireEvent, screen, within } from "@testing-library/react"
import type { RequestHandler } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, vi } from "vitest"

import { getPrototype } from "../../requests/get-prototype"
import { getSession } from "../../requests/get-session"
import { renderHubFlow } from "../../routes/test-fixture"
import { mockDiagnostics } from "../diagnostics"

const { start, stop, setupWorker } = vi.hoisted(() => {
  const start = vi.fn<() => Promise<ServiceWorkerRegistration | undefined>>()
  const stop = vi.fn<() => void>()
  const worker = { start, stop, events: { on: vi.fn() } }
  return {
    start,
    stop,
    setupWorker: vi.fn<(...handlers: RequestHandler[]) => typeof worker>(() => worker),
  }
})

vi.mock("msw/browser", () => ({ setupWorker }))

describe("startMockApi()", () => {
  it("stops a partially started worker before surfacing startup failure", async () => {
    const failure = new Error("Service worker registration failed.")
    start.mockRejectedValueOnce(failure)
    const { startMockApi } = await import(".")

    await expect(startMockApi()).rejects.toBe(failure)

    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })

  it("starts a fresh world and discards saved edits and drafts after a same-viewer toolbar persona change", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    const { startMockApi } = await import(".")
    await startMockApi()
    const firstHandlers = setupWorker.mock.calls[0]
    if (!firstHandlers) throw new Error("The first document must register its API handlers.")
    const server = setupServer(...firstHandlers)
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1", {
      withTools: true,
    })
    const request = new Request(`${window.location.origin}/repositories/2001/prototypes/1`)
    const original = await getPrototype(request, 2001, 1)
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const dialog = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
      target: { value: "Only the previous document" },
    })
    await router.settle(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Save details" })),
    )
    expect((await getPrototype(request, 2001, 1)).prototype.name).toBe("Only the previous document")
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const draft = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(draft).getByRole("textbox", { name: "Name" }), {
      target: { value: "An abandoned editor draft" },
    })
    const nextDocument = vi.fn()
    const currentWindow = window
    vi.stubGlobal(
      "window",
      new Proxy(currentWindow, {
        get(target, property): unknown {
          if (property === "location") return { assign: nextDocument }
          return Reflect.get(target, property, target)
        },
      }),
    )
    try {
      fireEvent.change(screen.getByRole("combobox", { name: "Persona" }), {
        target: { value: "admin" },
      })
    } finally {
      vi.stubGlobal("window", currentWindow)
    }
    expect(nextDocument).toHaveBeenCalledExactlyOnceWith("/")
    router.close()
    expect(draft).not.toBeInTheDocument()

    await startMockApi()
    const nextHandlers = setupWorker.mock.calls[1]
    if (!nextHandlers) throw new Error("The new document must register a fresh API.")
    const freshServer = setupServer(...nextHandlers)
    await renderHubFlow(freshServer, "/repositories/2001/prototypes/1")

    expect(screen.getByRole("button", { name: "Account menu for @octocat" })).toBeVisible()
    expect((await getSession(request)).capabilities.administerHub).toBe(true)
    const fresh = await getPrototype(request, 2001, 1)
    expect(fresh.prototype.name).toBe(original.prototype.name)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByText("Only the previous document")).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue("An abandoned editor draft")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Name" })).toHaveValue(
      original.prototype.name,
    )
  })
})
