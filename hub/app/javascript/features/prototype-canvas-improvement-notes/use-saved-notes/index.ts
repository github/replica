import { useEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"
import type { Note } from "../types"

type SavedNotes = {
  identity: string
  revision: number
  notes: Note[]
  syncError: string | null
  activeBatch: string | null
}

export function useSavedNotes(token: string | undefined) {
  const [state, setState] = useState<SavedNotes | null>(null)
  const [error, setError] = useState("")
  const [refreshError, setRefreshError] = useState("")
  const [busy, setBusy] = useState(false)
  const current = useRef<SavedNotes | null>(null)
  const pending = useRef(false)
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
    let refreshing = false
    let lastSync = 0
    async function refresh() {
      if (pending.current || refreshing) return
      refreshing = true
      let syncing = false
      const started = generation.current
      try {
        const value = await request<SavedNotes>("/api/improvement-notes", token!)
        if (pending.current || started !== generation.current || !mounted.current) return
        accept(value)
        if (Date.now() - lastSync > 15_000) {
          lastSync = Date.now()
          pending.current = true
          syncing = true
          setBusy(true)
          accept(
            await request<SavedNotes>("/api/improvement-notes/sync", token!, {
              method: "POST",
              body: JSON.stringify({ identity: value.identity, revision: value.revision }),
            }),
          )
        }
        if (mounted.current) setRefreshError("")
      } catch (problem) {
        if (mounted.current) {
          if (problem instanceof Error && "statusCode" in problem && problem.statusCode === 403) {
            current.current = null
            setState(null)
            setError("")
          }
          setRefreshError(problem instanceof Error ? problem.message : String(problem))
        }
      } finally {
        refreshing = false
        if (syncing) {
          pending.current = false
          if (mounted.current) setBusy(false)
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 3000)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
    }
  }, [token])

  async function change(operation: string, input: Record<string, unknown> = {}): Promise<boolean> {
    if (!token || !current.current || pending.current) return false
    pending.current = true
    generation.current++
    setBusy(true)
    setError("")
    try {
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
      setError(problem instanceof Error ? problem.message : String(problem))
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return { state, error: error || refreshError, busy, change }
}
