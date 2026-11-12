import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"

export function useCommentingRecovery({
  identity,
  enabled,
  ready,
  bridgeProblem,
  token,
}: {
  identity: string
  enabled: boolean
  ready: boolean
  bridgeProblem: string
  token: string
}) {
  const [fixError, setFixError] = useState("")
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [requested, setRequested] = useState(false)
  const current = useRef(identity)
  useLayoutEffect(() => {
    current.current = identity
    return () => {
      current.current = ""
    }
  }, [identity])

  useEffect(() => {
    const reset = window.setTimeout(() => {
      setFixError("")
      setBusy(false)
      setDismissed(false)
      setRequested(false)
    }, 0)
    return () => {
      window.clearTimeout(reset)
    }
  }, [identity, enabled])

  async function fix() {
    const target = identity
    setFixError("")
    setBusy(true)
    try {
      await request("/api/commenting/fix", token, { method: "POST" })
      if (current.current === target) setRequested(true)
    } catch (cause) {
      if (current.current === target)
        setFixError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (current.current === target) setBusy(false)
    }
  }

  return {
    visible: enabled && !ready && !dismissed && Boolean(bridgeProblem),
    error: fixError,
    busy,
    requested,
    onFix: () => void fix(),
    onDismiss: () => setDismissed(true),
  }
}
