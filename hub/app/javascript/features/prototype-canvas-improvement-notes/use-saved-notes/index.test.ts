import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { canvasReviewError } from "@utils/canvas-review-error"
import { useSavedNotes } from "."

describe("useSavedNotes()", () => {
  it("saves before fixing only the new note and queues later mutations behind both requests", async () => {
    vi.useFakeTimers()
    const note = {
      id: 99,
      localId: "existing",
      revision: 1,
      kind: "improvement_note",
      author: "local",
      body: "Existing request",
      route: "/",
      target: "Save",
      selector: "#save",
      rect: { x: 1, y: 1, width: 10, height: 10 },
      thread: { originalStatus: "open", messages: [] },
      status: "open",
      sync: "local",
    }
    const state = {
      identity: "notes",
      revision: 3,
      notes: [note],
      syncError: null,
      activeBatch: null,
    }
    const created = { ...note, id: 7, localId: "created", revision: 4, body: "New request" }
    const saved = { ...state, revision: 9, notes: [created, note] }
    let releaseSave: ((response: Response) => void) | undefined
    let releaseFix: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path.endsWith("/fix"))
        return new Promise<Response>((resolve) => {
          releaseFix = resolve
        })
      if (path === "/api/improvement-notes" && options?.method === "POST")
        return new Promise<Response>((resolve) => {
          releaseSave = resolve
        })
      return Promise.resolve(Response.json(state))
    })
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let changed: ReturnType<typeof view.result.current.createAndFix> | undefined
      act(() => {
        changed = view.result.current.createAndFix({ body: "New request" })
      })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(view.result.current.busy).toBe(true)
      expect(releaseFix).toBeUndefined()
      let later: Promise<boolean> | undefined
      act(() => {
        later = view.result.current.change("create", { body: "Later request" })
      })
      await act(async () => {
        if (!releaseSave) throw new Error("Expected a pending save.")
        releaseSave(Response.json(saved))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(view.result.current.state).toEqual(saved)
      expect(view.result.current.busy).toBe(true)
      function writes() {
        return fetch.mock.calls.filter(
          ([path, options]) => options?.method === "POST" && !path.endsWith("/sync"),
        )
      }
      expect(writes().map(([path]) => path)).toEqual([
        "/api/improvement-notes",
        "/api/improvement-notes/fix",
      ])
      const body = writes()[1]?.[1]?.body
      if (typeof body !== "string") throw new Error("Expected a serialized scoped fix.")
      expect(JSON.parse(body)).toEqual({
        identity: saved.identity,
        revision: saved.revision,
        noteIds: [{ id: created.id, revision: created.revision }],
      })
      const fixedState = {
        ...saved,
        revision: 10,
        activeBatch: "batch",
        notes: [{ ...created, status: "sent" }, note],
      }
      await act(async () => {
        if (!releaseFix) throw new Error("Expected a pending scoped fix.")
        releaseFix(Response.json(fixedState))
        await changed
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(writes().map(([path]) => path)).toEqual([
        "/api/improvement-notes",
        "/api/improvement-notes/fix",
        "/api/improvement-notes",
      ])
      expect(view.result.current.busy).toBe(true)
      await act(async () => {
        releaseSave?.(Response.json({ ...fixedState, revision: 11 }))
        expect(await later).toBe(true)
      })
      expect(view.result.current.busy).toBe(false)
      expect(view.result.current.state?.activeBatch).toBe("batch")
      expect(view.result.current.state?.notes.find(({ id }) => id === 99)).toEqual(note)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it.each(["save", "fix"])(
    "keeps recoverable state and reports a failed create-and-fix %s",
    async (failure) => {
      vi.useFakeTimers()
      const state = {
        identity: "notes",
        revision: 0,
        notes: [],
        syncError: null,
        activeBatch: null,
      }
      const saved = {
        ...state,
        revision: 1,
        notes: [
          {
            id: 1,
            localId: "new",
            revision: 1,
            body: "Keep this request",
            status: "open",
          },
        ],
      }
      const fetch = vi.fn((path: string, options?: RequestInit) => {
        if (path.endsWith("/fix"))
          return Promise.resolve(Response.json({ error: "Fix could not start." }, { status: 409 }))
        if (path === "/api/improvement-notes" && options?.method === "POST")
          return Promise.resolve(
            failure === "save"
              ? Response.json({ error: "Save failed." }, { status: 503 })
              : Response.json(saved),
          )
        return Promise.resolve(Response.json(state))
      })
      vi.stubGlobal("fetch", fetch)
      const view = renderHook(() => useSavedNotes("local"))
      try {
        await act(() => vi.advanceTimersByTimeAsync(0))
        await act(async () => {
          await view.result.current.createAndFix({ body: "Keep this request" })
        })
        expect(view.result.current.state).toEqual(failure === "save" ? state : saved)
        expect(view.result.current.error).toBe(
          failure === "save" ? "Save failed." : "Fix could not start.",
        )
        expect(view.result.current.busy).toBe(false)
        expect(fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))).toHaveLength(
          failure === "save" ? 0 : 1,
        )
      } finally {
        view.unmount()
        vi.useRealTimers()
      }
    },
  )

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
      expect(view.result.current.error).toMatch(/improvements changed/i)
      expect(view.result.current.busy).toBe(false)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("keeps Fix selected scoped when sync discovers other open work", async () => {
    vi.useFakeTimers()
    const selected = {
      id: 1,
      localId: "selected",
      revision: 1,
      kind: "improvement_note",
      author: "local",
      body: "Selected work",
      route: "/",
      target: "Save",
      selector: "#save",
      rect: { x: 1, y: 1, width: 10, height: 10 },
      thread: { originalStatus: "open", messages: [] },
      status: "open",
      sync: "synced",
    }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [selected],
      syncError: null,
      activeBatch: null,
    }
    const unselected = { ...selected, id: 2, localId: "unselected", body: "Other work" }
    let releaseSync: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path.endsWith("/sync"))
        return new Promise<Response>((resolve) => {
          releaseSync = resolve
        })
      if (path.endsWith("/fix")) return Promise.resolve(Response.json(state))
      return Promise.resolve(
        Response.json(
          options?.method === "POST"
            ? state
            : {
                ...state,
                revision: 2,
                notes: [selected, unselected],
              },
        ),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let changed: Promise<boolean> | undefined
      act(() => {
        changed = view.result.current.change("fix", {
          noteIds: [{ id: selected.id, revision: selected.revision }],
        })
      })
      await act(async () => {
        if (!releaseSync) throw new Error("Expected pending background sync.")
        releaseSync(Response.json({ ...state, revision: 2, notes: [selected, unselected] }))
        expect(await changed).toBe(true)
      })
      const request = fetch.mock.calls.find(([path]) => path.endsWith("/fix"))
      if (typeof request?.[1]?.body !== "string") throw new Error("Expected a serialized fix.")
      expect(JSON.parse(request[1].body)).toMatchObject({
        operation: "fix",
        noteIds: [{ id: selected.id, revision: selected.revision }],
      })
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("fixes only the work captured by a click queued behind a different mutation", async () => {
    vi.useFakeTimers()
    const note = { id: 1, revision: 1, status: "open" }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [note],
      syncError: null,
      activeBatch: null,
    }
    const later = { id: 2, revision: 1, status: "open" }
    let releaseMutation: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/improvement-notes" && options?.method === "POST")
        return new Promise<Response>((resolve) => {
          releaseMutation = resolve
        })
      if (path.endsWith("/fix")) return Promise.resolve(Response.json({ ...state, revision: 3 }))
      return Promise.resolve(Response.json(state))
    })
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let mutation: Promise<boolean> | undefined
      let fix: Promise<boolean> | undefined
      act(() => {
        mutation = view.result.current.change("create", { body: "Later work" })
        fix = view.result.current.change("fix")
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
        if (!releaseMutation) throw new Error("Expected pending mutation.")
        releaseMutation(Response.json({ ...state, revision: 2, notes: [note, later] }))
        expect(await mutation).toBe(true)
        expect(await fix).toBe(true)
      })
      const request = fetch.mock.calls.find(([path]) => path.endsWith("/fix"))
      if (typeof request?.[1]?.body !== "string") throw new Error("Expected a serialized fix.")
      expect(JSON.parse(request[1].body)).toMatchObject({
        revision: 2,
        scope: "all",
        noteIds: [{ id: 1, revision: 1 }],
      })
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("omits only work captured by an earlier fix from the queued click", async () => {
    vi.useFakeTimers()
    const first = { id: 1, revision: 1, status: "open" }
    const second = { id: 2, revision: 1, status: "open" }
    const later = { id: 3, revision: 1, status: "open" }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [first, second],
      syncError: null,
      activeBatch: null,
    }
    let releaseFix: ((response: Response) => void) | undefined
    let fixes = 0
    const fetch = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>((path) => {
      if (path.endsWith("/fix")) {
        if (++fixes === 1)
          return new Promise<Response>((resolve) => {
            releaseFix = resolve
          })
        return Promise.resolve(Response.json({ ...state, revision: 3 }))
      }
      return Promise.resolve(Response.json(state))
    })
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let firstFix: Promise<boolean> | undefined
      let queuedFix: Promise<boolean> | undefined
      act(() => {
        firstFix = view.result.current.change("fix", { noteIds: [{ id: 1, revision: 1 }] })
        queuedFix = view.result.current.change("fix")
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
        if (!releaseFix) throw new Error("Expected pending fix.")
        releaseFix(
          Response.json({
            ...state,
            revision: 2,
            notes: [{ ...first, revision: 2, status: "sent" }, second, later],
            activeBatch: "batch",
          }),
        )
        expect(await firstFix).toBe(true)
        expect(await queuedFix).toBe(true)
      })
      const requests = fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))
      expect(requests).toHaveLength(2)
      const body = requests[1]?.[1]?.body
      if (typeof body !== "string") throw new Error("Expected a serialized fix.")
      expect(JSON.parse(body)).toMatchObject({
        scope: "all",
        noteIds: [{ id: 2, revision: 1 }],
      })
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("reports a stale queued fix rather than silently dropping changed work", async () => {
    vi.useFakeTimers()
    const note = { id: 1, revision: 1, status: "open" }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [note],
      syncError: null,
      activeBatch: null,
    }
    let releaseMutation: ((response: Response) => void) | undefined
    const fetch = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/improvement-notes" && options?.method === "POST")
        return new Promise<Response>((resolve) => {
          releaseMutation = resolve
        })
      return Promise.resolve(Response.json(state))
    })
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let mutation: Promise<boolean> | undefined
      let fix: Promise<boolean> | undefined
      act(() => {
        mutation = view.result.current.change("follow-up", { id: 1, body: "New work" })
        fix = view.result.current.change("fix", { noteIds: [{ id: 1, revision: 1 }] })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
        if (!releaseMutation) throw new Error("Expected pending mutation.")
        releaseMutation(Response.json({ ...state, revision: 2, notes: [{ ...note, revision: 2 }] }))
        expect(await mutation).toBe(true)
        expect(await fix).toBe(false)
      })
      expect(fetch.mock.calls.some(([path]) => path.endsWith("/fix"))).toBe(false)
      expect(view.result.current.error).toMatch(/improvements changed/i)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("shows an actionable retry when another panel changes notes before a fix", async () => {
    vi.useFakeTimers()
    const note = { id: 1, revision: 1, status: "open" }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [note],
      syncError: null,
      activeBatch: null,
    }
    const fetch = vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith("/fix")
          ? Response.json(
              { error: "These notes changed in another panel. Reload before making changes." },
              { status: 409 },
            )
          : Response.json(state),
      ),
    )
    vi.stubGlobal("fetch", fetch)
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      await act(async () => {
        expect(await view.result.current.change("fix")).toBe(false)
      })
      expect(fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))).toHaveLength(1)
      const visibleError = canvasReviewError(view.result.current.error)
      expect(visibleError).toMatch(/review|reload/i)
      expect(visibleError).toMatch(/try|retry/i)
      expect(view.result.current.state).toEqual(state)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it("keeps a failed fix visible when a later queued fix succeeds", async () => {
    vi.useFakeTimers()
    const note = { id: 1, revision: 1, status: "open" }
    const state = {
      identity: "notes",
      revision: 1,
      notes: [note],
      syncError: null,
      activeBatch: null,
    }
    let releaseFix: ((response: Response) => void) | undefined
    let fixes = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path.endsWith("/fix")) {
          if (++fixes === 1)
            return new Promise<Response>((resolve) => {
              releaseFix = resolve
            })
          return Promise.resolve(Response.json({ ...state, revision: 2 }))
        }
        return Promise.resolve(Response.json(state))
      }),
    )
    const view = renderHook(() => useSavedNotes("local"))
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      let failed: Promise<boolean> | undefined
      let succeeded: Promise<boolean> | undefined
      act(() => {
        failed = view.result.current.change("fix")
        succeeded = view.result.current.change("fix")
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
        if (!releaseFix) throw new Error("Expected pending fix.")
        releaseFix(Response.json({ error: "First fix failed." }, { status: 409 }))
        expect(await failed).toBe(false)
        expect(await succeeded).toBe(true)
      })
      expect(fixes).toBe(2)
      expect(view.result.current.error).toBe("First fix failed.")
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it.each(["delete", "fix"])(
    "keeps background sync invisible and queues foreground %s requests with the refreshed revision",
    async (operation) => {
      vi.useFakeTimers()
      const state = {
        identity: "notes",
        revision: 1,
        notes: [{ id: 1, revision: 1, status: "open" }],
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
          changed = view.result.current.change(
            operation,
            operation === "fix"
              ? { noteIds: [{ id: 1, revision: 1 }] }
              : { id: 1, expectedNoteRevision: 1 },
          )
        })
        expect(view.result.current.busy).toBe(true)
        let queuedChange: Promise<boolean> | undefined
        act(() => {
          queuedChange = view.result.current.change(
            operation,
            operation === "fix"
              ? { noteIds: [{ id: 1, revision: 1 }] }
              : { id: 1, expectedNoteRevision: 1 },
          )
        })
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
        expect(JSON.parse(body)).toMatchObject(
          operation === "fix"
            ? { identity: "notes", revision: 2, noteIds: [{ id: 1, revision: 1 }] }
            : { identity: "notes", revision: 2, expectedNoteRevision: 1 },
        )
        expect(view.result.current.busy).toBe(true)
        await act(async () => {
          if (!releaseChange) throw new Error("Expected pending foreground change.")
          releaseChange(
            Response.json({
              ...state,
              revision: 3,
              notes:
                operation === "fix"
                  ? [{ ...state.notes[0], revision: 2, status: "sent" }]
                  : state.notes,
            }),
          )
          expect(await changed).toBe(true)
          await vi.advanceTimersByTimeAsync(0)
        })
        if (operation === "fix") {
          expect(await queuedChange).toBe(false)
          expect(
            fetch.mock.calls.filter(
              ([path, options]) => options?.method === "POST" && !path.endsWith("/sync"),
            ),
          ).toHaveLength(1)
          expect(view.result.current.busy).toBe(false)
          return
        }
        expect(
          fetch.mock.calls.filter(
            ([path, options]) => options?.method === "POST" && !path.endsWith("/sync"),
          ),
        ).toHaveLength(2)
        expect(view.result.current.busy).toBe(true)
        await act(async () => {
          releaseChange?.(Response.json({ ...state, revision: 4 }))
          expect(await queuedChange).toBe(true)
        })
        expect(view.result.current.busy).toBe(false)
        expect(view.result.current.state?.revision).toBe(4)
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
