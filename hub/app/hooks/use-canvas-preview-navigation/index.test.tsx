import { act, renderHook } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { publicationHub } from "@utils/resolve-prototype-publication/fixtures"
import { usePreviewNavigation } from "."

function mount() {
  const cancelClick = createRef<(() => void) | null>()
  const shellRef = createRef<HTMLElement>()
  return {
    ...renderHook(() =>
      usePreviewNavigation({
        prototypeUrl: "http://localhost:4321/",
        shellRef,
        cancelClick,
      }),
    ),
    cancelClick,
  }
}

describe("usePreviewNavigation()", () => {
  it("keeps invalid URL overrides available for diagnosis without breaking route reporting", () => {
    const { result } = mount()
    act(() =>
      result.current.replaceAddress(
        "http://localhost:4321/?q=hello%20world&rc.page.title=one&rc.page.title=two",
      ),
    )
    act(() =>
      result.current.reportRoute({ pathname: "/", search: "?q=hello+world&rc=1", hash: "" }),
    )
    expect(result.current.navigation.entries).toHaveLength(1)
    expect(new URL(result.current.address).searchParams.getAll("rc.page.title")).toEqual([
      "one",
      "two",
    ])
  })
  it("keeps Controls settings in the prototype address without creating navigation entries", () => {
    const { result } = mount()
    const frame = result.current.frameRef
    act(() => result.current.replaceAddress("http://localhost:4321/?rc.page.title=%22Changed%22"))
    act(() => result.current.reportRoute({ pathname: "/", search: "?rc=1", hash: "" }))
    expect(result.current.navigation.entries).toHaveLength(1)
    expect(new URL(result.current.address).searchParams.get("rc.page.title")).toBe('"Changed"')
    expect(result.current.source).toBe("http://localhost:4321/")
    expect(result.current.frameRef).toBe(frame)
    act(() => result.current.reportRoute({ pathname: "/", search: "?view=app", hash: "" }, true))
    expect(result.current.navigation.entries).toHaveLength(1)
    expect(new URL(result.current.address).searchParams.get("view")).toBe("app")
    act(() =>
      result.current.reportRoute({ pathname: "/next", search: "?view=app", hash: "#section" }),
    )
    expect(result.current.navigation.entries).toHaveLength(2)
    expect(new URL(result.current.address).searchParams.get("rc.page.title")).toBe('"Changed"')
  })
  it("loads proxy routes while keeping upstream addresses and history", () => {
    const { result } = renderHook(() =>
      usePreviewNavigation({
        prototypeUrl: "http://localhost:4321/start?q=1#section",
        previewUrl: "http://127.0.0.1:12345/start?q=1#section",
        shellRef: createRef<HTMLElement>(),
        cancelClick: createRef<(() => void) | null>(),
      }),
    )
    expect(result.current.source).toBe("http://127.0.0.1:12345/start?q=1#section")
    expect(result.current.address).toBe("http://localhost:4321/start?q=1#section")
    act(() => result.current.navigate("http://localhost:4321/next?q=2#form"))
    expect(result.current.source).toBe("http://127.0.0.1:12345/next?q=2#form")
    act(() => result.current.reportRoute({ pathname: "/nested", search: "?q=3", hash: "#last" }))
    expect(result.current.address).toBe("http://localhost:4321/nested?q=3#last")
    act(() => result.current.travel(0))
    expect(result.current.source).toBe("http://127.0.0.1:12345/start?q=1#section")
  })

  it("applies the start page once without replacing the frame", () => {
    const { result } = mount()
    const frame = result.current.frameRef
    act(() =>
      result.current.initialize({ ...publicationHub, localStartPage: "/settings?q=1#form" }),
    )
    expect(result.current.source).toBe("http://localhost:4321/settings?q=1#form")
    expect(result.current.address).toBe(result.current.source)
    act(() => result.current.initialize({ ...publicationHub, localStartPage: "/other" }))
    expect(result.current.address).toBe("http://localhost:4321/settings?q=1#form")
    expect(result.current.frameRef).toBe(frame)
  })

  it("rejects a start page outside the prototype origin", () => {
    const { result } = mount()
    expect(() =>
      result.current.initialize({
        ...publicationHub,
        localStartPage: "https://other.example.com/settings",
      }),
    ).toThrow("Hub returned a start page outside the prototype.")
    expect(result.current.source).toBe("http://localhost:4321/")
  })

  it("keeps route history until navigation replaces the forward entries", () => {
    const { result } = mount()
    const frame = result.current.frameRef
    const route = { pathname: "/settings", search: "?q=1", hash: "#form" }
    act(() => result.current.reportRoute(route))
    act(() => result.current.reportRoute(route))
    expect(result.current.navigation.entries).toHaveLength(2)
    act(() => result.current.travel(0))
    expect(result.current.address).toBe("http://localhost:4321/")
    act(() => result.current.navigate("http://localhost:4321/other"))
    expect(result.current.navigation.entries).toEqual([
      "http://localhost:4321/",
      "http://localhost:4321/other",
    ])
    expect(result.current.frameRef).toBe(frame)
  })

  it("replaces the frame and cancels a pending click when the current address is reloaded", () => {
    const { result, cancelClick } = mount()
    const frame = result.current.frameRef
    cancelClick.current = vi.fn()
    act(() => result.current.reportRoute({ pathname: "/", search: "", hash: "" }))
    act(() => result.current.navigate(result.current.address))
    expect(result.current.frameRef).not.toBe(frame)
    expect(result.current.frameKey).toBe(1)
    expect(result.current.liveRoute).toBeNull()
    expect(cancelClick.current).toHaveBeenCalledOnce()
  })
})
