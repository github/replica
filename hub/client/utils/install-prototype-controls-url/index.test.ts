// @vitest-environment jsdom
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import { installControlsUrl } from "."

let dispose: (() => void) | undefined

beforeEach(() => {
  onTestFinished(() => {
    dispose?.()
    dispose = undefined
  })
})

describe("installControlsUrl()", () => {
  it("leaves startup history and links unchanged before the handshake", () => {
    window.history.replaceState({ router: "initial" }, "", "/dashboard")
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
    const controls = installControlsUrl(vi.fn(), () => ({}), vi.fn())
    dispose = () => controls.dispose()

    controls.refresh()
    window.history.replaceState({ router: "startup" }, "", "/dashboard#/dashboard")
    const link = document.createElement("a")
    link.href = "/settings"
    document.body.appendChild(link)
    link.addEventListener("click", (event) => event.preventDefault())
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    expect(window.location.search).toBe("")
    expect(window.location.hash).toBe("#/dashboard")
    expect(window.history.state).toEqual({ router: "startup" })
    expect(link.search).toBe("")
    expect(controls.managed()).toBe(false)
    link.remove()
  })

  it.each(["loading", "interactive"] as const)(
    "waits for DOMContentLoaded when the handshake arrives during %s",
    (state) => {
      window.history.replaceState({ router: "initial" }, "", "/dashboard")
      const ready = vi.spyOn(document, "readyState", "get").mockReturnValue(state)
      const controls = installControlsUrl(vi.fn(), () => ({}), vi.fn())
      dispose = () => controls.dispose()
      const length = window.history.length

      controls.set('rc.page.title="Saved"')
      controls.refresh()
      window.history.replaceState({ router: "startup" }, "", "/dashboard#/dashboard")
      expect(window.location.search).toBe("")

      ready.mockReturnValue("interactive")
      controls.set('rc.page.title="Saved"')
      controls.refresh()
      window.history.replaceState({ router: "startup" }, "", "/dashboard#/dashboard")
      const link = document.createElement("a")
      link.href = "/settings"
      link.addEventListener("click", (event) => event.preventDefault())
      document.body.appendChild(link)
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      expect(window.location.search).toBe("")
      expect(link.search).toBe("")
      link.remove()

      document.dispatchEvent(new Event("DOMContentLoaded"))
      expect(new URLSearchParams(window.location.search).get("rc")).toBe("1")
      expect(new URLSearchParams(window.location.search).get("rc.page.title")).toBe('"Saved"')
      expect(window.location.hash).toBe("#/dashboard")
      expect(window.history.state).toEqual({ router: "startup" })
      expect(window.history.length).toBe(length)
    },
  )

  it("initializes immediately when installed after DOMContentLoaded while still interactive", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("interactive")
    vi.stubGlobal("performance", {
      getEntriesByType: vi.fn().mockReturnValue([{ domContentLoadedEventStart: 123 }]),
    })
    const controls = installControlsUrl(vi.fn(), () => ({}), vi.fn())
    dispose = () => controls.dispose()

    controls.set('rc.page.title="Saved"')
    expect(new URLSearchParams(window.location.search).get("rc")).toBe("1")
    expect(new URLSearchParams(window.location.search).get("rc.page.title")).toBe('"Saved"')
  })

  it("keeps initialized defaults authoritative after reset and navigation", () => {
    window.history.replaceState({ router: "initial" }, "", '/?rc.page.title="Saved"#/dashboard')
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
    const navigate = vi.fn()
    const controls = installControlsUrl(navigate, () => ({}), vi.fn())
    dispose = () => controls.dispose()

    controls.set("")
    expect(window.location.search).toBe("?rc=1")
    expect(controls.current()).toBe("")
    expect(controls.managed()).toBe(true)
    window.history.pushState({ router: "next" }, "", "/settings?view=details")
    expect(window.location.pathname).toBe("/settings")
    expect(window.location.search).toBe("?view=details&rc=1")
    expect(window.history.state).toEqual({ router: "next" })
    window.dispatchEvent(new PopStateEvent("popstate"))
    expect(navigate).toHaveBeenLastCalledWith("")
  })

  it("preserves existing marked overrides until the handshake adopts them", () => {
    window.history.replaceState(null, "", '/?rc=1&rc.page.title="Saved"#/issues')
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
    const controls = installControlsUrl(vi.fn(), () => ({}), vi.fn())
    dispose = () => controls.dispose()
    const address = window.location.href

    controls.refresh()
    expect(window.location.href).toBe(address)
    expect(controls.managed()).toBe(true)
    controls.set(controls.current())
    expect(new URLSearchParams(window.location.search).get("rc.page.title")).toBe('"Saved"')
    expect(window.location.hash).toBe("#/issues")
  })

  it("removes the deferred startup listener when disposed", () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading")
    const controls = installControlsUrl(vi.fn(), () => ({}), vi.fn())
    controls.set("")
    controls.dispose()
    vi.restoreAllMocks()
    document.dispatchEvent(new Event("DOMContentLoaded"))
    expect(window.location.search).toBe("")
  })
})
