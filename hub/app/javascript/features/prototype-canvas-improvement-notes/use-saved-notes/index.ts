import { useEffect, useRef, useState } from "react"

import { prototypeCanvasRequest } from "@utils/prototype-canvas-request"
import { copy } from "../en"
import type { Note } from "../types"

type SavedNotes = {
  identity: string
  revision: number
  notes: Note[]
  syncError: string | null
  activeBatch: string | null
  profileError?: string | null
}

function openWork(value: SavedNotes) {
  return value.notes
    .filter((note) => note.status === "open")
    .map((note) => `${note.id}:${note.revision}`)
    .sort()
}

export function useSavedNotes(token: string | undefined) {
  const [state, setState] = useState<SavedNotes | null>(null)
  const [error, setError] = useState("")
  const [refreshError, setRefreshError] = useState("")
  const [busy, setBusy] = useState(false)
  const current = useRef<SavedNotes | null>(null)
  const pending = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const queued = useRef(0)
  const backgroundSync = useRef<Promise<void> | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)

  function accept(value: SavedNotes) {
    if (!mounted.current) return
    current.current = value
    setState(value)
  }

  useEffect(() => {
    if (!token) return
    mounted.current = true
    let cancelled = false
    let refreshing = false
    let lastSync = 0
    async function refresh() {
      if (pending.current || refreshing) return
      refreshing = true
      const started = generation.current
      try {
        const value = await prototypeCanvasRequest<SavedNotes>("/api/improvement-notes", token!)
        if (pending.current || started !== generation.current || cancelled) return
        accept(value)
        if (Date.now() - lastSync > 15_000) {
          lastSync = Date.now()
          const syncing = prototypeCanvasRequest<SavedNotes>(
            "/api/improvement-notes/sync",
            token!,
            {
              method: "POST",
              body: JSON.stringify({ identity: value.identity, revision: value.revision }),
            },
          ).then((value) => {
            if (!cancelled) accept(value)
          })
          backgroundSync.current = syncing
          try {
            await syncing
          } finally {
            if (backgroundSync.current === syncing) backgroundSync.current = null
          }
        }
        if (!cancelled) setRefreshError("")
      } catch (problem) {
        if (!cancelled) {
          if (problem instanceof Error && "statusCode" in problem && problem.statusCode === 403) {
            current.current = null
            setState(null)
            setError("")
          }
          setRefreshError(problem instanceof Error ? problem.message : String(problem))
        }
      } finally {
        refreshing = false
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 3000)
    return () => {
      mounted.current = false
      cancelled = true
      window.clearInterval(interval)
    }
  }, [token])

  // Mutations run one at a time in click order so a fix requested during another request queues.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    queued.current++
    pending.current = true
    generation.current++
    setBusy(true)
    const run = queue.current.then(task)
    queue.current = run
      .catch(() => undefined)
      .finally(() => {
        queued.current--
        if (queued.current) return
        pending.current = false
        if (mounted.current) setBusy(false)
      })
    return run
  }

  function performChange(
    operation: string,
    input: Record<string, unknown> = {},
    fixCreated = false,
  ) {
    if (!token || !current.current) return Promise.resolve({ changed: false, fixStarted: false })
    const identity = current.current.identity
    const requestedWork = openWork(current.current)
    return enqueue(() => runChange(operation, input, fixCreated, identity, requestedWork))
  }

  async function runChange(
    operation: string,
    input: Record<string, unknown>,
    fixCreated: boolean,
    identity: string,
    requestedWork: string[],
  ) {
    let changed = false
    if (!token || !mounted.current) return { changed, fixStarted: false }
    setError("")
    try {
      await backgroundSync.current
      if (!mounted.current) return { changed, fixStarted: false }
      if (!current.current || current.current.identity !== identity)
        throw new Error(copy.branchChanged)
      if (operation === "fix") {
        const open = openWork(current.current)
        const remaining = requestedWork.filter((work) => open.includes(work))
        // An earlier queued fix already captured everything this click selected.
        if (requestedWork.length && !remaining.length) return { changed, fixStarted: false }
        if (open.join(",") !== remaining.join(",")) throw new Error(copy.workChanged)
      }
      const previousIds = new Set(current.current.notes.map((note) => note.id))
      const value = await prototypeCanvasRequest<SavedNotes>(
        operation === "fix" ? "/api/improvement-notes/fix" : "/api/improvement-notes",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            identity: current.current.identity,
            revision: current.current.revision,
            operation,
            ...input,
          }),
        },
      )
      accept(value)
      changed = true
      if (fixCreated) {
        const created = value.notes.filter((note) => !previousIds.has(note.id))
        if (created.length !== 1) throw new Error(copy.createdNoteUnavailable)
        const note = created[0]!
        const fixed = await prototypeCanvasRequest<SavedNotes>(
          "/api/improvement-notes/fix",
          token,
          {
            method: "POST",
            body: JSON.stringify({
              identity: value.identity,
              revision: value.revision,
              id: note.id,
              expectedNoteRevision: note.revision,
            }),
          },
        )
        accept(fixed)
      }
      return { changed, fixStarted: fixCreated }
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : String(problem))
      return { changed, fixStarted: false }
    }
  }

  async function change(operation: string, input: Record<string, unknown> = {}) {
    return (await performChange(operation, input)).changed
  }

  async function createAndFix(input: Record<string, unknown>) {
    return performChange("create", input, true)
  }

  async function capture(): Promise<{ identity: string; sourceId: string } | null> {
    if (!token) return null
    setError("")
    try {
      return await prototypeCanvasRequest("/api/improvement-notes/capture", token, {
        method: "POST",
      })
    } catch (problem) {
      setError(
        `${problem instanceof Error ? problem.message : String(problem)} ${copy.sourceUnavailable}`,
      )
      return null
    }
  }

  return { state, error: error || refreshError, busy, change, createAndFix, capture }
}
