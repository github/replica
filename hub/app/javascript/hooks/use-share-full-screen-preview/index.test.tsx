import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useShareFullScreenPreview } from "."

describe("useShareFullScreenPreview()", () => {
  it("synchronizes mounted consumers and restores their saved choice after remounting", () => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    const first = renderHook(() => useShareFullScreenPreview())
    const second = renderHook(() => useShareFullScreenPreview())
    expect(first.result.current.fullScreenPreview).toBe(true)
    expect(second.result.current.fullScreenPreview).toBe(true)

    act(() => first.result.current.onChange(false))

    expect(first.result.current.fullScreenPreview).toBe(false)
    expect(second.result.current.fullScreenPreview).toBe(false)
    expect(localStorage.getItem("replica:share-full-screen-preview:v1")).toBe("false")
    first.unmount()
    second.unmount()
    const restored = renderHook(() => useShareFullScreenPreview())
    expect(restored.result.current.fullScreenPreview).toBe(false)

    act(() => restored.result.current.onChange(true))

    expect(restored.result.current.fullScreenPreview).toBe(true)
    expect(localStorage.getItem("replica:share-full-screen-preview:v1")).toBe("true")
  })

  it("reports unavailable saved preferences instead of silently claiming they were restored", () => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    const { result } = renderHook(() => useShareFullScreenPreview())

    expect(result.current.fullScreenPreview).toBe(true)
    expect(result.current.error).not.toBe("")
    read.mockRestore()
  })

  it("keeps an unsaved change local and reports that it could not be remembered", () => {
    localStorage.removeItem("replica:share-full-screen-preview:v1")
    const first = renderHook(() => useShareFullScreenPreview())
    const second = renderHook(() => useShareFullScreenPreview())
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })

    act(() => first.result.current.onChange(false))

    expect(first.result.current.fullScreenPreview).toBe(false)
    expect(first.result.current.error).not.toBe("")
    expect(second.result.current.fullScreenPreview).toBe(true)
    expect(localStorage.getItem("replica:share-full-screen-preview:v1")).toBeNull()
    write.mockRestore()
  })
})
