import { useEffect, useRef, useState } from "react"

import { copy } from "@utils/prototype-canvas/en"
import { request } from "@utils/prototype-canvas-request"
import type { HubStatus } from "@utils/prototype-canvas/types"

type Props = {
  token: string
  status: HubStatus | null
  onStatusChange: () => Promise<void>
  onSelectHub: (origin: string) => Promise<void>
}

export function useHubConnection({ token, status, onStatusChange, onSelectHub }: Props) {
  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState("")
  const [pollFailed, setPollFailed] = useState(false)
  const [started, setStarted] = useState<{
    repository: string
    hubOrigin: string
    pairing: NonNullable<HubStatus["pairing"]>
  } | null>(null)
  const offered = useRef(false)
  const connectingRef = useRef(false)
  const connected = status?.state === "connected" || status?.state === "undiscovered"
  const needsConnection =
    status?.state === "disconnected" ||
    status?.state === "pairing" ||
    status?.state === "unconfigured"
  const pairing = connected
    ? null
    : status?.pairing ||
      (started?.repository === status?.repository && started?.hubOrigin === status?.hubOrigin
        ? started?.pairing
        : null)
  const verificationUrl = pairing?.verificationUrl

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (connected) {
        setOpen(false)
        setStarted(null)
        setError("")
      } else if (needsConnection && status?.repository && !offered.current) {
        offered.current = true
        setOpen(true)
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [connected, needsConnection, status?.repository])

  useEffect(() => {
    if (!verificationUrl || pollFailed) return
    let disposed = false
    let polling = false
    async function poll() {
      if (polling) return
      polling = true
      try {
        const result = await request<{ status: string }>("/api/hub/poll", token, {
          method: "POST",
          body: "{}",
        })
        if (disposed) return
        if (result.status !== "pending") {
          setStarted(null)
          if (result.status !== "approved") setError(copy.connectionApprovalExpired)
          await onStatusChange()
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setPollFailed(true)
        }
      } finally {
        polling = false
      }
    }
    const interval = window.setInterval(() => void poll(), 3_000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [verificationUrl, pollFailed, token, onStatusChange, status?.repository, status?.hubOrigin])

  async function connect(origin?: string) {
    offered.current = true
    if (connectingRef.current) return
    if (!status?.repository) {
      setError(copy.connectionRepositoryRequired)
      return
    }
    if (!status.hubOrigin && !origin) {
      setError(copy.connectionHubRequired)
      return
    }
    connectingRef.current = true
    setConnecting(true)
    setError("")
    setPollFailed(false)
    try {
      if (!status.hubOrigin && origin) await onSelectHub(origin)
      const result = await request<NonNullable<HubStatus["pairing"]> & { browserError?: string }>(
        "/api/hub/connect",
        token,
        { method: "POST", body: "{}" },
      )
      setStarted({
        repository: status.repository,
        hubOrigin: new URL(result.verificationUrl).origin,
        pairing: result,
      })
      if (result.browserError) setError(copy.connectionBrowserFailed(result.browserError))
      await onStatusChange()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }

  function showAndConnect() {
    setOpen(true)
    if (status?.hubOrigin) void connect()
  }

  return {
    open,
    close: () => setOpen(false),
    show: () => setOpen(true),
    showAndConnect,
    connect,
    connecting,
    error,
    pairing,
  }
}
