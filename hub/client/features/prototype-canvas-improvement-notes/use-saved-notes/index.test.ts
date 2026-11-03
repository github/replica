import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useSavedNotes } from "."

describe("useSavedNotes()", () => {
  it("does not expand a queued Fix all snapshot when sync discovers new open work", async () => {
    vi.useFakeTimers()
    const state = { identity: "notes", revision: 1, notes: [], syncError: null, activeBatch: null }
    let releaseSync: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string) =>
      path.endsWith("/sync")
        ? new Promise<Response>((resolve) => {
            releaseSync = resolve
          })
        : Promise.resolve(Response.json(state)),
    )
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let changed: Promise<boolean> | undefined
      act(() => {
        changed = view.result.current.change("fix")
      })
      await act(async () => {
        if (!releaseSync) throw new Error("Expected pending background sync.")
        releaseSync(
          Response.json({
            ...state,
            revision: 2,
            notes: [
              {
                id: 1,
                localId: "original",
                revision: 1,
                kind: "improvement_note",
                author: "local",
                body: "Newly synchronized work",
                route: "/",
                target: "Save",
                selector: "#save",
                rect: { x: 1, y: 1, width: 10, height: 10 },
                thread: { originalStatus: "open", messages: [] },
                status: "open",
                sync: "synced",
              },
            ],
          }),
        )
        expect(await changed).toBe(false)
      })
      expect(fetch.mock.calls.some(([path]) => path.endsWith("/fix"))).toBe(false)
      expect(view.result.current.error).toMatch(/open improvements changed/i)
      expect(view.result.current.busy).toBe(false)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it.each(["delete", "fix"])(
    "keeps background sync invisible and serializes one foreground %s with the refreshed revision",
    async (operation) => {
      vi.useFakeTimers()
      const state = {
        identity: "notes",
        revision: 1,
        notes: [],
        syncError: null,
        activeBatch: null,
      }
      let syncs = 0
      let releaseSync: ((response: Response) => void) | undefined
      let releaseChange: ((response: Response) => void) | undefined
      const fetch = vi.fn((path: string, options?: RequestInit) => {
        if (path.endsWith("/sync") && ++syncs === 2)
          return new Promise<Response>((resolve) => {
            releaseSync = resolve
          })
        if (options?.method === "POST" && !path.endsWith("/sync"))
          return new Promise<Response>((resolve) => {
            releaseChange = resolve
          })
        return Promise.resolve(Response.json(state))
      })
      vi.stubGlobal("fetch", fetch)
      const busyStates: boolean[] = []
      const view = renderHook(() => {
        const value = useSavedNotes("local")
        busyStates.push(value.busy)
        return value
      })
      try {
        await act(() => vi.advanceTimersByTimeAsync(0))
        await act(() => vi.advanceTimersByTimeAsync(18_000))
        expect(syncs).toBe(2)
        expect(releaseSync).toBeDefined()
        expect(busyStates).not.toContain(true)
        let changed: Promise<boolean> | undefined
        act(() => {
          changed = view.result.current.change(operation, { id: 1, expectedNoteRevision: 1 })
        })
        expect(view.result.current.busy).toBe(true)
        expect(await view.result.current.change(operation)).toBe(false)
        expect(releaseChange).toBeUndefined()
        await act(async () => {
          if (!releaseSync) throw new Error("Expected pending background sync.")
          releaseSync(Response.json({ ...state, revision: 2 }))
          await vi.advanceTimersByTimeAsync(0)
        })
        const writes = fetch.mock.calls.filter(
          ([path, options]) => options?.method === "POST" && !path.endsWith("/sync"),
        )
        expect(writes).toHaveLength(1)
        const body = writes[0]?.[1]?.body
        if (typeof body !== "string") throw new Error("Expected a serialized mutation.")
        expect(JSON.parse(body)).toMatchObject({
          identity: "notes",
          revision: 2,
          expectedNoteRevision: 1,
        })
        expect(view.result.current.busy).toBe(true)
        await act(async () => {
          if (!releaseChange) throw new Error("Expected pending foreground change.")
          releaseChange(Response.json({ ...state, revision: 3 }))
          expect(await changed).toBe(true)
        })
        expect(view.result.current.busy).toBe(false)
        expect(view.result.current.state?.revision).toBe(3)
      } finally {
        view.unmount()
        vi.useRealTimers()
      }
    },
  )

  it("rejects a queued action if background sync changes branch or author identity", async () => {
    vi.useFakeTimers()
    const state = { identity: "first", revision: 1, notes: [], syncError: null, activeBatch: null }
    let releaseSync: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string) =>
      path.endsWith("/sync")
        ? new Promise<Response>((resolve) => {
            releaseSync = resolve
          })
        : Promise.resolve(Response.json(state)),
    )
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let changed: Promise<boolean> | undefined
      act(() => {
        changed = view.result.current.change("fix")
      })
      await act(async () => {
        if (!releaseSync) throw new Error("Expected pending background sync.")
        releaseSync(Response.json({ ...state, identity: "second", revision: 2 }))
        expect(await changed).toBe(false)
      })
      expect(fetch.mock.calls.some(([path]) => path.endsWith("/fix"))).toBe(false)
      expect(view.result.current.error).toMatch(/branch changed/i)
      expect(view.result.current.busy).toBe(false)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

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
