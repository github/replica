import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { App } from ".."
import { sharingFixture } from "./sharing-fixture"

describe("App() prototype health", () => {
  it("keeps disconnected navigation disabled while appearance controls remain usable", () => {
    const { fetch } = sharingFixture(undefined, { state: "unconfigured" })
    const respond = fetch.getMockImplementation()!
    fetch.mockImplementation((path, options) =>
      path === "/api/servers"
        ? Promise.resolve(Response.json({ servers: [], warnings: [] }))
        : respond(path, options),
    )
    const view = render(
      <App config={{ name: "New prototype", prototypeUrl: null, token: "local" }} />,
    )
    expect(screen.getByRole("textbox", { name: "Prototype address" })).toBeDisabled()
    for (const name of ["Back", "Forward", "Reload preview", "Open preview in browser"])
      expect(screen.getByRole("button", { name })).toBeDisabled()
    const dark = screen.getByRole("button", { name: "Dark appearance" })
    expect(dark).toBeEnabled()
    expect(screen.getByRole("button", { name: "Light appearance" })).toBeEnabled()
    fireEvent.click(dark)
    expect(dark).toHaveAttribute("aria-pressed", "true")
    expect(view.container.querySelector(".canvas-base")).toHaveAttribute("data-color-mode", "dark")
    expect(screen.queryByTitle("New prototype prototype")).not.toBeInTheDocument()
    view.unmount()
  })

  it.each([
    ["http://localhost:4321/", true],
    [null, false],
  ] as const)(
    "reloads %s only when server availability changes",
    async (prototypeUrl, initialAvailability) => {
      vi.useFakeTimers()
      const reload = vi.fn()
      vi.stubGlobal(
        "window",
        new Proxy(window, {
          get(target, key) {
            return key === "location"
              ? { ...target.location, reload }
              : (Reflect.get(target, key, target) as unknown)
          },
        }),
      )
      let available = initialAvailability
      const { fetch } = sharingFixture(undefined, { state: "unconfigured" })
      const respond = fetch.getMockImplementation()!
      fetch.mockImplementation((path, options) => {
        if (path === "/api/prototype/status") return Promise.resolve(Response.json({ available }))
        if (path === "/api/servers")
          return Promise.resolve(Response.json({ servers: [], warnings: [] }))
        return respond(path, options)
      })
      const view = render(
        <App config={{ name: "Demo", prototypeUrl, token: "local", monitorPrototype: true }} />,
      )
      expect(fetch.mock.calls.filter(([path]) => path === "/api/prototype/status")).toHaveLength(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(fetch.mock.calls.filter(([path]) => path === "/api/prototype/status")).toHaveLength(1)
      expect(reload).not.toHaveBeenCalled()
      available = !available
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(reload).toHaveBeenCalledOnce()
      view.unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(fetch.mock.calls.filter(([path]) => path === "/api/prototype/status")).toHaveLength(2)
    },
  )

  it("does not poll health when the canvas is not monitoring a local server", async () => {
    vi.useFakeTimers()
    const { fetch } = sharingFixture(undefined, { state: "unconfigured" })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetch.mock.calls.filter(([path]) => path === "/api/prototype/status")).toHaveLength(0)
    view.unmount()
  })
})
