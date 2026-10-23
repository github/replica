import { useCallback, useEffect, useEffectEvent, useState, type RefObject } from "react"

import {
  ANCHOR_RESOLUTION_SCHEMA,
  REVIEW_ANCHOR_SCHEMA,
  REVIEW_ROUTE_SCHEMA,
} from "@utils/review-anchor/schemas"
import type { AnchorResolution, ReviewAnchor } from "@utils/review-anchor/types"
import { copy } from "../en"
import type { Note } from "../types"

type Props = {
  frameRef?: RefObject<HTMLIFrameElement | null>
  prototypeUrl?: string
  previewUrl?: string
  notes: Note[]
  annotating: boolean
  composing: boolean
  pendingSelection: boolean
  onSelect: (anchor: ReviewAnchor) => void
  onRoute: (route: string) => void
  onCancel: () => void
  onProblem: (message: string) => void
  onToggle: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function usePreviewSelection({
  frameRef,
  prototypeUrl,
  previewUrl,
  notes,
  annotating,
  composing,
  pendingSelection,
  onSelect,
  onRoute,
  onCancel,
  onProblem,
  onToggle,
}: Props) {
  const frameUrl = previewUrl ?? prototypeUrl
  const [connection, setConnection] = useState<{ nonce: string; ready: boolean } | null>(null)
  const [resolutions, setResolutions] = useState<Map<number, AnchorResolution>>(new Map())
  const anchorKey = JSON.stringify(
    notes.filter((note) => note.anchor).map((note) => ({ id: note.id, anchor: note.anchor })),
  )
  const receiveSelection = useEffectEvent((value: unknown) => {
    if (!annotating || composing) return
    const anchor = REVIEW_ANCHOR_SCHEMA.safeParse(value)
    if (anchor.success) {
      onSelect(anchor.data)
    } else {
      onCancel()
      onProblem(copy.previewUnavailable)
    }
  })
  const toggleSelection = useEffectEvent(onToggle)
  const dismissConversation = useEffectEvent((restoreFocus: boolean) => {
    if (pendingSelection && restoreFocus) {
      onCancel()
      return
    }
    window.dispatchEvent(
      new CustomEvent("replica:review-dismiss", {
        detail: { restoreFocus },
      }),
    )
  })
  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (!frameUrl || !connection || !frameRef?.current?.contentWindow) return
      frameRef.current.contentWindow.postMessage(
        { type, nonce: connection.nonce, ...payload },
        new URL(frameUrl).origin,
      )
    },
    [connection, frameRef, frameUrl],
  )

  useEffect(() => {
    const frame = frameRef?.current
    if (!frame || !frameUrl) return
    const origin = new URL(frameUrl).origin
    let nonce = crypto.randomUUID()
    let lastResponse = Date.now()
    const anchors: unknown = JSON.parse(anchorKey)
    function requestState() {
      frame?.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce, selectionShortcut: true },
        origin,
      )
      frame?.contentWindow?.postMessage({ type: "replica:canvas:resolve", nonce, anchors }, origin)
    }
    function loaded() {
      nonce = crypto.randomUUID()
      lastResponse = Date.now()
      setConnection({ nonce, ready: false })
      setResolutions(new Map())
      onCancel()
      requestState()
    }
    function receive(event: MessageEvent<unknown>) {
      const data = event.data
      if (
        event.source !== frame?.contentWindow ||
        event.origin !== origin ||
        !isRecord(data) ||
        data.nonce !== nonce
      )
        return
      if (data.type === "replica:canvas:ready") {
        const route = REVIEW_ROUTE_SCHEMA.safeParse(data.route)
        if (data.protocolVersion !== 1 || data.improvementSelection !== true || !route.success) {
          setConnection({ nonce, ready: false })
          onProblem(copy.bridgeUnavailable)
          return
        }
        lastResponse = Date.now()
        setConnection((previous) =>
          previous?.nonce === nonce && previous.ready ? previous : { nonce, ready: true },
        )
        onRoute(route.data.pathname + route.data.search + route.data.hash)
      } else if (data.type === "replica:canvas:selected") {
        receiveSelection(data.anchor)
      } else if (data.type === "replica:canvas:selection-toggle-requested") {
        toggleSelection()
      } else if (data.type === "replica:canvas:resolved" && Array.isArray(data.results)) {
        const next = new Map<number, AnchorResolution>()
        for (const result of data.results) {
          if (!isRecord(result)) continue
          const parsed = ANCHOR_RESOLUTION_SCHEMA.safeParse({
            commentId: result.id,
            status: "resolved",
            point: { x: result.x, y: result.y },
            rect: result.rect ?? { x: result.x, y: result.y, width: 1, height: 1 },
          })
          if (parsed.success) next.set(parsed.data.commentId, parsed.data)
        }
        setResolutions(next)
      } else if (
        data.type === "replica:canvas:selection-failed" ||
        data.type === "replica:canvas:bridge-error"
      ) {
        onCancel()
        onProblem(data.reason === "area-too-small" ? copy.regionSmall : copy.bridgeUnavailable)
      } else if (data.type === "replica:canvas:selection-cancelled") {
        if (data.reason !== "command") onCancel()
      } else if (data.type === "replica:canvas:conversation-dismiss-requested") {
        dismissConversation(data.restoreFocus !== false)
      }
    }
    frame.addEventListener("load", loaded)
    window.addEventListener("message", receive)
    setConnection({ nonce, ready: false })
    requestState()
    const interval = window.setInterval(() => {
      if (Date.now() - lastResponse > 20_000) {
        setConnection({ nonce, ready: false })
        setResolutions(new Map())
        onCancel()
        onProblem(copy.bridgeUnavailable)
      }
      requestState()
    }, 2_000)
    return () => {
      frame.removeEventListener("load", loaded)
      window.removeEventListener("message", receive)
      window.clearInterval(interval)
      frame.contentWindow?.postMessage({ type: "replica:canvas:cancel-selection", nonce }, origin)
      frame.contentWindow?.postMessage({ type: "replica:canvas:clear-selection", nonce }, origin)
      frame.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce, selectionShortcut: false },
        origin,
      )
    }
  }, [anchorKey, frameRef, frameUrl, onCancel, onProblem, onRoute])

  useEffect(() => {
    if (!connection?.ready) return
    if (annotating && !composing) send("replica:canvas:select", { mode: "improvement" })
    else send("replica:canvas:cancel-selection")
    if (!composing) send("replica:canvas:clear-selection")
  }, [annotating, composing, connection?.ready, send])

  return { ready: connection?.ready === true, resolutions }
}
