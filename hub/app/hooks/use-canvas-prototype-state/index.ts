import { useCallback, useEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"
import type { PrototypeState } from "@utils/prototype-canvas/types"

export function usePrototypeState(token: string) {
  const [state, setState] = useState<PrototypeState | null>(null)
  const [error, setError] = useState("")
  const currentState = useRef<PrototypeState | null>(null)
  const latestRequest = useRef(0)
  const inFlight = useRef(0)

  const refresh = useCallback(
    async (force: boolean, periodic = false) => {
      if (periodic && inFlight.current > 0) return
      inFlight.current += 1
      const requestId = ++latestRequest.current
      try {
        const nextState = await request<PrototypeState>(
          force ? "/api/refresh" : "/api/state",
          token,
          force ? { method: "POST", body: "{}" } : {},
        )
        if (requestId !== latestRequest.current) return
        currentState.current = nextState
        setState(nextState)
        setError("")
      } catch (requestError) {
        if (requestId !== latestRequest.current) return
        setState((previous) =>
          previous
            ? {
                ...previous,
                stats: {
                  ...previous.stats,
                  remoteBranch: {
                    state: "unknown",
                    repository: previous.stats.repository || null,
                    branch: previous.stats.branch || null,
                    commitSha: previous.stats.commitSha || null,
                    error: errorMessage(requestError),
                  },
                },
              }
            : previous,
        )
        setError(errorMessage(requestError))
      } finally {
        inFlight.current -= 1
      }
    },
    [token],
  )

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(true), 0)
    const interval = window.setInterval(() => {
      const status = currentState.current?.publishStatus?.state
      const publishRequest = currentState.current?.publishRequest
      const pending =
        status === "requested" ||
        status === "in_progress" ||
        publishRequest?.state === "requested" ||
        (Boolean(publishRequest?.requestedAt) &&
          (status === "not_published" || status === "unavailable"))
      void refresh(pending, true)
    }, 15_000)

    function handleFocus() {
      void refresh(true)
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      latestRequest.current += 1
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      window.removeEventListener("focus", handleFocus)
    }
  }, [refresh])

  return { state, error, setError, refresh }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
