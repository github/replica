import { useCallback, useEffect, useRef, useState } from "react"

import { copy } from "@utils/prototype-canvas/en"
import { request } from "@utils/prototype-canvas-request"
import type { HubStatus } from "@utils/prototype-canvas/types"

type Props = {
  token: string
  onStatus: (status: HubStatus) => void
  onError: (message: string) => void
}

/** Applies only current Hub responses and keeps background polling from recording activity. */
export function useHubStatus({ token, onStatus, onError }: Props) {
  const [status, setStatus] = useState<HubStatus | null>(null)
  const latestRequest = useRef(0)
  const inFlight = useRef(0)
  const changingHub = useRef(false)

  const refresh = useCallback(
    async (reason?: "open" | "interaction", periodic = false) => {
      if (changingHub.current || (periodic && inFlight.current > 0)) return

      inFlight.current += 1
      const requestId = ++latestRequest.current
      try {
        const interactive = reason === "open" || reason === "interaction"
        const next = await request<HubStatus>(
          interactive
            ? reason === "open"
              ? "/api/hub/open"
              : "/api/hub/activity"
            : "/api/hub/status",
          token,
          interactive ? { method: "POST", body: "{}" } : {},
        )
        if (requestId !== latestRequest.current || changingHub.current) return

        setStatus(next)
        const startPageError = next.prototype?.startPageImportError || next.localStartPageError
        if (startPageError) onError(startPageError)
        onStatus(next)
      } catch (cause) {
        if (requestId !== latestRequest.current || changingHub.current) return

        const message = cause instanceof Error ? cause.message : String(cause)
        setStatus((previous) => ({
          state: "unavailable",
          repository: previous?.repository,
          branch: previous?.branch,
          hubOrigin: previous?.hubOrigin,
          message: copy.hubStatusUnavailable(message),
        }))
        onError(message)
      } finally {
        inFlight.current -= 1
      }
    },
    [token, onStatus, onError],
  )

  const select = useCallback(
    async (origin: string) => {
      changingHub.current = true
      latestRequest.current += 1
      setStatus(null)
      try {
        await request("/api/hub/origin", token, {
          method: "POST",
          body: JSON.stringify({ origin }),
        })
      } finally {
        changingHub.current = false
        await refresh()
      }
    },
    [token, refresh],
  )

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh("open"), 0)
    const timer = window.setInterval(() => void refresh(undefined, true), 15_000)
    function handleFocus() {
      void refresh("interaction")
    }
    window.addEventListener("focus", handleFocus)
    return () => {
      latestRequest.current += 1
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.removeEventListener("focus", handleFocus)
    }
  }, [refresh])

  async function reset() {
    const next = await request<HubStatus>("/api/hub/discovery", token, {
      method: "POST",
      body: "{}",
    })
    if (next.discovery?.state !== "valid" || !next.discovery.origin)
      throw new Error(next.discovery?.message || copy.resetHubUnavailable)

    await refresh()
    return next.discovery.origin
  }

  return { status, refresh, select, reset }
}
