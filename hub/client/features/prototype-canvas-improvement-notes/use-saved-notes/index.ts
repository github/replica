import { useEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"
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

export function useSavedNotes(token: string | undefined) {
  const [state, setState] = useState<SavedNotes | null>(null)
  const [error, setError] = useState("")
  const [refreshError, setRefreshError] = useState("")
  const [busy, setBusy] = useState(false)
  const current = useRef<SavedNotes | null>(null)
  const pending = useRef(false)
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
        const value = await request<SavedNotes>("/api/improvement-notes", token!)
        if (pending.current || started !== generation.current || cancelled) return
        accept(value)
        if (Date.now() - lastSync > 15_000) {
          lastSync = Date.now()
          const syncing = request<SavedNotes>("/api/improvement-notes/sync", token!, {
            method: "POST",
            body: JSON.stringify({ identity: value.identity, revision: value.revision }),
          }).then((value) => {
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

  async function change(operation: string, input: Record<string, unknown> = {}): Promise<boolean> {
    if (!token || !current.current || pending.current) return false
    const identity = current.current.identity
    const requestedWork = current.current.notes
      .filter((note) => note.status === "open")
      .map((note) => `${note.id}:${note.revision}`)
      .sort()
      .join(",")
    pending.current = true
    generation.current++
    setBusy(true)
    setError("")
    try {
      await backgroundSync.current
      if (!mounted.current) return false
      if (!current.current || current.current.identity !== identity)
        throw new Error(copy.branchChanged)
      if (
        operation === "fix" &&
        current.current.notes
          .filter((note) => note.status === "open")
          .map((note) => `${note.id}:${note.revision}`)
          .sort()
          .join(",") !== requestedWork
      )
        throw new Error(copy.workChanged)
      const value = await request<SavedNotes>(
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
      return true
    } catch (problem) {
      if (mounted.current) setError(problem instanceof Error ? problem.message : String(problem))
      return false
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function capture(): Promise<{ identity: string; sourceId: string } | null> {
    if (!token) return null
    setError("")
    try {
      return await request("/api/improvement-notes/capture", token, { method: "POST" })
    } catch (problem) {
      setError(
        `${problem instanceof Error ? problem.message : String(problem)} ${copy.sourceUnavailable}`,
      )
      return null
    }
  }

  return { state, error: error || refreshError, busy, change, capture }
}
