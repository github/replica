import { useCallback, useEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"
import type { ChecksAction, ChecksState } from "@utils/prototype-checks/types"

export function usePrototypeChecks(token: string) {
  const [state, setState] = useState<ChecksState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const pending = useRef(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    try {
      const next = await request<ChecksState>("/api/checks", token)
      if (mounted.current && current === generation.current) {
        setState(next)
        setError(null)
      }
    } catch (cause) {
      if (mounted.current && current === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setState((previous) => (previous ? { ...previous, state: "error" } : null))
      }
    }
  }, [token])
  useEffect(() => {
    mounted.current = true
    let polling = false
    async function poll() {
      if (polling) return
      polling = true
      try {
        await refresh()
      } finally {
        polling = false
      }
    }
    function invalidatePendingResponses() {
      generation.current++
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => {
      mounted.current = false
      invalidatePendingResponses()
      window.clearInterval(timer)
    }
  }, [refresh])
  const action = useCallback(
    async (input: ChecksAction) => {
      if (pending.current) return false
      pending.current = true
      setBusy(true)
      try {
        await request("/api/checks/action", token, { method: "POST", body: JSON.stringify(input) })
        if (!mounted.current) return false
        await refresh()
        return true
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        pending.current = false
        if (mounted.current) setBusy(false)
      }
    },
    [token, refresh],
  )
  return { state, error, busy, action }
}
