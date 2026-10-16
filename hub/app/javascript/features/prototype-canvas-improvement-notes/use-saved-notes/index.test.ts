import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useSavedNotes } from "."

describe("useSavedNotes()", () => {
  it("keeps a failed save visible through successful polling until an explicit retry", async () => {
    vi.useFakeTimers()
    let rejectSave = true
    const state = {
      identity: "notes",
      revision: 1,
      notes: [],
      syncError: null,
      activeBatch: null,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, options?: RequestInit) =>
        Promise.resolve(
          path === "/api/improvement-notes" && options?.method === "POST" && rejectSave
            ? Response.json({ error: "The note could not be saved." }, { status: 409 })
            : Response.json(state),
        ),
      ),
    )
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(view.result.current.state).toEqual(state)
      await act(async () => {
        expect(await view.result.current.change("edit", { id: 1, body: "Updated" })).toBe(false)
      })
      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(view.result.current.error).toBe("The note could not be saved.")
      rejectSave = false
      await act(async () => {
        expect(await view.result.current.change("edit", { id: 1, body: "Updated" })).toBe(true)
      })
      expect(view.result.current.error).toBe("")
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })
})
