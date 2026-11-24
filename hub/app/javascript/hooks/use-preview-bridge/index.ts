import { useCallback, useEffect, useRef, useState } from "react"

import { chunkArray } from "@utils/chunk-array"
import { getPreviewFrameUrl } from "@utils/get-preview-frame-url"
import { getUrlOrigin } from "@utils/get-url-origin"
import {
  OPTIONS_TOGGLE_EVENT,
  PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE,
  PREVIEW_BRIDGE_PROTOCOL_VERSION,
} from "@utils/preview-bridge/constants"
import { PREVIEW_BRIDGE_MESSAGE_SCHEMA } from "@utils/preview-bridge/schemas"
import type {
  PreviewBridgeCommandPayloads,
  PreviewBridgeCommandType,
} from "@utils/preview-bridge/types"
import type { AnchorResolution, ReviewAnchor, ReviewRoute } from "@utils/review-anchor/types"

import type { PreviewBridgeOptions, PreviewBridgeState, ReviewSelectionFailure } from "./types"

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  const editable = target.closest("[contenteditable]")
  return (
    target.matches("input, textarea, select") ||
    (editable !== null && editable.getAttribute("contenteditable") !== "false")
  )
}

/** Accepts messages only from the selected preview frame and origin. */
export function usePreviewBridge({
  iframeRef,
  previewUrl,
  previewTheme,
  anchors,
  reviewEnabled = true,
  onSelectionStart,
  onToggleSidebar,
  selectionBlocked = false,
}: PreviewBridgeOptions): PreviewBridgeState {
  const [ready, setReady] = useState(false)
  const [reportedRoute, setReportedRoute] = useState<{
    previewUrl: string | undefined
    route: ReviewRoute
  } | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null)
  const [selectionFailure, setSelectionFailure] = useState<ReviewSelectionFailure | null>(null)
  const [resolutions, setResolutions] = useState<Map<number, AnchorResolution>>(new Map())
  const pendingSelectionRequest = useRef<string | null>(null)
  const fragmentRestoration = useRef<{
    previewUrl: string | undefined
    requestId: string
    pending: boolean
  } | null>(null)
  const previewOrigin = getUrlOrigin(previewUrl)
  const restoreFragment = getPreviewFrameUrl(previewUrl) !== previewUrl
  const route =
    reportedRoute && reportedRoute.previewUrl === previewUrl ? reportedRoute.route : null

  const post = useCallback(
    <Type extends PreviewBridgeCommandType>(
      type: Type,
      payload: PreviewBridgeCommandPayloads[Type],
    ) => {
      if (
        !reviewEnabled &&
        type !== "replica:bridge:request-ready" &&
        type !== "replica:bridge:restore-fragment" &&
        type !== "replica:bridge:set-theme"
      )
        return null

      const target = iframeRef.current?.contentWindow
      if (!target || !previewOrigin) return null

      const requestId = crypto.randomUUID()
      target.postMessage(
        {
          protocolVersion: PREVIEW_BRIDGE_PROTOCOL_VERSION,
          requestId,
          type,
          payload,
        },
        previewOrigin,
      )
      return requestId
    },
    [iframeRef, previewOrigin, reviewEnabled],
  )

  const handleFrameLoad = useCallback(() => {
    setReady(false)
    setReportedRoute(null)
    setSelecting(false)
    setSelectionFailure(null)
    setResolutions(new Map())
    pendingSelectionRequest.current = null
    fragmentRestoration.current = null
    post("replica:bridge:request-ready", {})
  }, [post])

  const startSelection = useCallback(() => {
    if (!ready || selectedAnchor || selecting || selectionBlocked) return

    const requestId = post("replica:bridge:select-element", {})
    if (!requestId) return

    pendingSelectionRequest.current = requestId
    onSelectionStart?.()
    setSelectionFailure(null)
    setSelecting(true)
  }, [onSelectionStart, post, ready, selectedAnchor, selectionBlocked, selecting])

  useEffect(() => {
    if (!reviewEnabled) return

    function handleCommentShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const action =
        key !== "c" ? null : event.shiftKey ? (onToggleSidebar ?? null) : startSelection
      if (
        !ready ||
        selectedAnchor !== null ||
        selecting ||
        selectionBlocked ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !action ||
        isEditableTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      action()
    }

    window.addEventListener("keydown", handleCommentShortcut)
    return () => window.removeEventListener("keydown", handleCommentShortcut)
  }, [
    onToggleSidebar,
    reviewEnabled,
    ready,
    selectedAnchor,
    selectionBlocked,
    selecting,
    startSelection,
  ])

  const cancelSelection = useCallback(() => {
    const requestId = post("replica:bridge:cancel-selection", {})
    if (!requestId) return

    pendingSelectionRequest.current = requestId
    setSelecting(false)
  }, [post])

  const clearSelection = useCallback(() => {
    post("replica:bridge:clear-selection", {})
    setSelectedAnchor(null)
    setSelectionFailure(null)
  }, [post])

  const focusAnchor = useCallback(
    (commentId: number) => {
      post("replica:bridge:focus-anchor", { commentId })
    },
    [post],
  )

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      const frameWindow = iframeRef.current?.contentWindow
      if (
        !previewOrigin ||
        !frameWindow ||
        event.origin !== previewOrigin ||
        event.source !== frameWindow
      ) {
        return
      }

      const parsedMessage = PREVIEW_BRIDGE_MESSAGE_SCHEMA.safeParse(event.data)
      if (!parsedMessage.success) return

      const message = parsedMessage.data
      if (message.type === "replica:bridge:ready") {
        const restoration = fragmentRestoration.current
        if (restoreFragment && previewUrl) {
          if (restoration?.previewUrl === previewUrl && restoration.pending) {
            if (message.requestId !== restoration.requestId) return

            restoration.pending = false
          } else if (restoration?.previewUrl !== previewUrl) {
            const destination = new URL(previewUrl)
            if (
              message.payload.route.pathname === destination.pathname &&
              message.payload.route.search === destination.search
            ) {
              const requestId = post("replica:bridge:restore-fragment", {
                route: {
                  pathname: destination.pathname,
                  search: destination.search,
                  hash: destination.hash,
                },
              })
              if (!requestId) return

              fragmentRestoration.current = { previewUrl, requestId, pending: true }
              return
            }
            fragmentRestoration.current = {
              previewUrl,
              requestId: message.requestId,
              pending: false,
            }
          }
        }
        setReady(true)
        setReportedRoute({ previewUrl, route: message.payload.route })
        return
      }

      if (message.type === "replica:bridge:route-changed") {
        if (
          restoreFragment &&
          (fragmentRestoration.current?.previewUrl !== previewUrl ||
            fragmentRestoration.current?.pending)
        )
          return

        setResolutions(new Map())
        setReportedRoute({ previewUrl, route: message.payload.route })
        return
      }
      if (!reviewEnabled) return

      if (message.type === "replica:bridge:conversation-dismiss-requested") {
        window.dispatchEvent(new Event("replica:review-dismiss"))
        return
      }

      if (message.type === "replica:bridge:element-selection-requested") {
        startSelection()
        return
      }

      if (message.type === "replica:bridge:options-toggle-requested") {
        if (!selecting) window.dispatchEvent(new Event(OPTIONS_TOGGLE_EVENT))
        return
      }

      if (message.type === "replica:bridge:sidebar-toggle-requested") {
        if (ready && !selectedAnchor && !selecting && !selectionBlocked) {
          onToggleSidebar?.()
        }
        return
      }

      if (message.type === "replica:bridge:anchors-resolved") {
        setResolutions((current) => {
          const next = new Map(current)
          for (const result of message.payload.results) next.set(result.commentId, result)
          return next
        })
        return
      }

      if (message.type === "replica:bridge:anchor-focused") {
        setResolutions((current) => {
          const next = new Map(current)
          next.set(message.payload.result.commentId, message.payload.result)
          return next
        })
        return
      }

      if (message.requestId !== pendingSelectionRequest.current) return

      pendingSelectionRequest.current = null
      setSelecting(false)
      if (
        message.type === "replica:bridge:element-selected" ||
        message.type === "replica:bridge:area-selected"
      ) {
        setSelectedAnchor(message.payload.anchor)
      } else if (message.type === "replica:bridge:selection-failed") {
        setSelectionFailure(message.payload.reason)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    iframeRef,
    onToggleSidebar,
    post,
    previewOrigin,
    previewUrl,
    restoreFragment,
    ready,
    reviewEnabled,
    selectedAnchor,
    selectionBlocked,
    selecting,
    startSelection,
  ])

  useEffect(() => {
    if (ready) post("replica:bridge:set-theme", { theme: previewTheme })
  }, [post, previewTheme, ready])

  useEffect(() => {
    if (!ready || !reviewEnabled) return

    const batches = chunkArray(anchors, PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE)
    if (batches.length === 0) {
      post("replica:bridge:resolve-anchors", { replace: true, anchors: [] })
      return
    }

    batches.forEach((batch, index) => {
      post("replica:bridge:resolve-anchors", { replace: index === 0, anchors: batch })
    })
  }, [anchors, post, ready, reviewEnabled])

  return {
    ready,
    route,
    selecting,
    selectedAnchor,
    selectionFailure,
    resolutions,
    handleFrameLoad,
    startSelection,
    cancelSelection,
    clearSelection,
    focusAnchor,
  }
}
