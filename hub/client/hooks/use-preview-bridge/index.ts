import { useCallback, useEffect, useRef, useState } from "react"

import { chunkArray } from "@utils/chunk-array"
import { getPreviewFrameUrl } from "@utils/get-preview-frame-url"
import { getUrlOrigin } from "@utils/get-url-origin"
import {
  PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE,
  PREVIEW_BRIDGE_PROTOCOL_VERSION,
} from "@utils/preview-bridge/constants"
import { PREVIEW_BRIDGE_MESSAGE_SCHEMA } from "@utils/preview-bridge/schemas"
import type {
  PreviewBridgeCommandPayloads,
  PreviewBridgeCommandType,
} from "@utils/preview-bridge/types"
import type { AnchorResolution, ReviewAnchor, ReviewRoute } from "@utils/review-anchor/types"

import type {
  PreviewBridgeOptions,
  PreviewBridgeState,
  ReviewSelectionFailure,
  ReviewSelectionMode,
} from "./types"

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
  const [selectionMode, setSelectionMode] = useState<ReviewSelectionMode | null>(null)
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null)
  const [selectionFailure, setSelectionFailure] = useState<ReviewSelectionFailure | null>(null)
  const [resolutions, setResolutions] = useState<Map<number, AnchorResolution>>(new Map())
  const pendingSelectionRequest = useRef<string | null>(null)
  const navigation = useRef<{ id: string; url: string; frame: Window; ready: boolean } | null>(null)
  const fragmentRestoration = useRef<{
    previewUrl: string | undefined
    requestId: string
    pending: boolean
  } | null>(null)
  const previewOrigin = getUrlOrigin(previewUrl)
  const accessUrl = previewUrl ? URL.parse(previewUrl) : null
  // The legacy access URL selects one Build and redirects to its unique origin.
  const isolated = Boolean(accessUrl && previewOrigin && previewOrigin !== accessUrl.origin)
  const restoreFragment = getPreviewFrameUrl(previewUrl) !== previewUrl
  const route =
    reportedRoute && reportedRoute.previewUrl === previewUrl ? reportedRoute.route : null
  const currentReady = ready && (!isolated || route !== null)

  const post = useCallback(
    <Type extends PreviewBridgeCommandType>(
      type: Type,
      payload: PreviewBridgeCommandPayloads[Type],
    ) => {
      if (
        !reviewEnabled &&
        type !== "replica:bridge:request-ready" &&
        type !== "replica:bridge:request-navigation-ready" &&
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
    if (isolated) setSelectedAnchor(null)
    setSelectionMode(null)
    setSelectionFailure(null)
    setResolutions(new Map())
    pendingSelectionRequest.current = null
    fragmentRestoration.current = null
    const id = post(
      isolated ? "replica:bridge:request-navigation-ready" : "replica:bridge:request-ready",
      {},
    )
    const frame = iframeRef.current?.contentWindow
    navigation.current =
      id && previewUrl && frame ? { id, url: previewUrl, frame, ready: false } : null
  }, [iframeRef, isolated, post, previewUrl])

  const startElementSelection = useCallback(() => {
    if (!currentReady || selectedAnchor || selectionMode || selectionBlocked) return

    const requestId = post("replica:bridge:select-element", {})
    if (!requestId) return

    pendingSelectionRequest.current = requestId
    onSelectionStart?.()
    setSelectionFailure(null)
    setSelectionMode("element")
  }, [currentReady, onSelectionStart, post, selectedAnchor, selectionBlocked, selectionMode])

  const startAreaSelection = useCallback(() => {
    if (!currentReady || selectedAnchor || selectionMode || selectionBlocked) return

    const requestId = post("replica:bridge:select-area", {})
    if (!requestId) return

    pendingSelectionRequest.current = requestId
    onSelectionStart?.()
    setSelectionFailure(null)
    setSelectionMode("area")
  }, [currentReady, onSelectionStart, post, selectedAnchor, selectionBlocked, selectionMode])

  useEffect(() => {
    if (!reviewEnabled) return

    function handleCommentShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const startSelection =
        !event.shiftKey && key === "c"
          ? startElementSelection
          : !event.shiftKey && key === "h"
            ? startAreaSelection
            : null
      const toggleComments = event.shiftKey && key === "c" ? onToggleSidebar : null
      if (
        !ready ||
        selectedAnchor !== null ||
        selectionMode !== null ||
        selectionBlocked ||
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (!startSelection && !toggleComments) ||
        isEditableTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      if (toggleComments) toggleComments()
      else startSelection?.()
    }

    window.addEventListener("keydown", handleCommentShortcut)
    return () => window.removeEventListener("keydown", handleCommentShortcut)
  }, [
    onToggleSidebar,
    reviewEnabled,
    ready,
    selectedAnchor,
    selectionBlocked,
    selectionMode,
    startAreaSelection,
    startElementSelection,
  ])

  const cancelSelection = useCallback(() => {
    const requestId = post("replica:bridge:cancel-selection", {})
    if (!requestId) return

    pendingSelectionRequest.current = requestId
    setSelectionMode(null)
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
      const current = navigation.current
      if (
        isolated &&
        (!current ||
          current.url !== previewUrl ||
          current.frame !== frameWindow ||
          current.id !== message.navigationId ||
          (!current.ready && message.type !== "replica:bridge:ready"))
      ) {
        return
      }
      if (message.type === "replica:bridge:ready") {
        const restoration = fragmentRestoration.current
        if (
          isolated &&
          (current?.ready ||
            message.requestId !== (restoration?.pending ? restoration.requestId : current?.id))
        )
          return
        if (restoreFragment && previewUrl) {
          if (restoration?.previewUrl === previewUrl && restoration.pending) {
            if (message.requestId !== restoration.requestId) return

            restoration.pending = false
          } else if (restoration?.previewUrl !== previewUrl) {
            const access = new URL(previewUrl)
            const destination = isolated
              ? new URL(access.searchParams.get("route") ?? "/", previewOrigin)
              : access
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
        if (current) current.ready = true
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

        if (isolated) {
          if (JSON.stringify(message.payload.route) === JSON.stringify(route)) return

          setSelectedAnchor(null)
          setSelectionMode(null)
          setSelectionFailure(null)
          pendingSelectionRequest.current = null
          post("replica:bridge:clear-selection", {})
          const id = post("replica:bridge:request-navigation-ready", {})
          navigation.current =
            id && previewUrl ? { id, url: previewUrl, frame: frameWindow, ready: false } : null
          setReady(false)
        }

        setResolutions(new Map())
        setReportedRoute({ previewUrl, route: message.payload.route })
        return
      }
      if (!reviewEnabled) return

      if (message.type === "replica:bridge:conversation-dismiss-requested") {
        window.dispatchEvent(new Event("replica:review-dismiss"))
        return
      }

      if (
        message.type === "replica:bridge:element-selection-requested" ||
        message.type === "replica:bridge:area-selection-requested"
      ) {
        if (!ready || selectedAnchor || selectionMode || selectionBlocked) return

        const mode =
          message.type === "replica:bridge:element-selection-requested" ? "element" : "area"
        const requestId = post(
          mode === "element" ? "replica:bridge:select-element" : "replica:bridge:select-area",
          {},
        )
        if (!requestId) return

        pendingSelectionRequest.current = requestId
        onSelectionStart?.()
        setSelectionFailure(null)
        setSelectionMode(mode)
        return
      }

      if (message.type === "replica:bridge:sidebar-toggle-requested") {
        if (ready && !selectedAnchor && !selectionMode && !selectionBlocked) {
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
      setSelectionMode(null)
      if (
        message.type === "replica:bridge:element-selected" ||
        message.type === "replica:bridge:area-selected"
      ) {
        if (isolated && JSON.stringify(message.payload.anchor.route) !== JSON.stringify(route))
          return
        setSelectedAnchor(message.payload.anchor)
      } else if (message.type === "replica:bridge:selection-failed") {
        setSelectionFailure(message.payload.reason)
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [
    iframeRef,
    isolated,
    onSelectionStart,
    onToggleSidebar,
    post,
    previewOrigin,
    previewUrl,
    restoreFragment,
    route,
    ready,
    reviewEnabled,
    selectedAnchor,
    selectionBlocked,
    selectionMode,
  ])

  useEffect(() => {
    if (currentReady) post("replica:bridge:set-theme", { theme: previewTheme })
  }, [currentReady, post, previewTheme])

  useEffect(() => {
    if (!currentReady || !reviewEnabled) return

    const batches = chunkArray(anchors, PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE)
    if (batches.length === 0) {
      post("replica:bridge:resolve-anchors", { replace: true, anchors: [] })
      return
    }

    batches.forEach((batch, index) => {
      post("replica:bridge:resolve-anchors", { replace: index === 0, anchors: batch })
    })
  }, [anchors, currentReady, post, reviewEnabled, route])

  return {
    ready: Boolean(currentReady),
    route,
    selecting: selectionMode !== null,
    selectionMode,
    selectedAnchor: !isolated || currentReady ? selectedAnchor : null,
    selectionFailure,
    resolutions,
    handleFrameLoad,
    startElementSelection,
    startAreaSelection,
    cancelSelection,
    clearSelection,
    focusAnchor,
  }
}
