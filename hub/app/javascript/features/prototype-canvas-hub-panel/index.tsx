import { GitBranchIcon, SyncIcon } from "@primer/octicons-react"
import { Button, Heading, Tooltip } from "@primer/react-brand"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"

import { HubCounter } from "@components/hub-counter"
import { HubAlert } from "@components/hub-alert"
import { MentionProvider } from "@components/mention-provider"
import { HubSidebar } from "@components/hub-sidebar"
import { ReviewCommentMarkers } from "@features/review-comment-markers"
import { ReviewCommentsSidebar } from "@features/review-comments-sidebar"
import { ReviewCommentControl } from "@features/prototype-workspace-header/review-comment-control"
import { DEFAULT_REVIEW_COMMENT_FILTERS } from "@hooks/use-prototype-review/constants"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { getAreaAnchorGeometry } from "@utils/get-area-anchor-geometry"
import { groupReviewCommentsIntoThreads } from "@utils/group-review-comments-into-threads"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import type { AnchorResolution, ReviewAnchor, ReviewRoute } from "@utils/review-anchor/types"
import {
  REVIEW_COMMENT_MUTATION_SCHEMA,
  REVIEW_COMMENT_PAGE_SCHEMA,
} from "@utils/review-comment/schemas"
import type { ReviewComment, ReviewReactionContent } from "@utils/review-comment/types"
import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import { reviewThreadMatchesFilters } from "@utils/review-thread-matches-filters"
import { MENTION_CANDIDATES_SCHEMA } from "@utils/mention-candidate/schemas"

import { request } from "@utils/prototype-canvas-request"
import { copy } from "@utils/prototype-canvas/en"
import { BranchPublication } from "@components/prototype-branch-publication"
import { CommentingRecovery } from "@components/prototype-commenting-recovery"
import { CanvasReviewOverlays } from "../prototype-review-overlays"
import { useCommentingRecovery } from "@hooks/use-canvas-commenting-recovery"
import type { Publication } from "@utils/resolve-prototype-publication"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"
import { PublishSettings } from "../prototype-publish-settings"
import type { usePublishPreference } from "@hooks/use-canvas-publish-preference"
import type { CanvasConfig, HubStatus } from "@utils/prototype-canvas/types"

import "./styles.css"

type Props = {
  config: CanvasConfig
  frameRef: RefObject<HTMLIFrameElement | null>
  onRouteChange?: (route: ReviewRoute, replace?: boolean) => void
  status: HubStatus | null
  onStatusChange: () => Promise<void>
  onSelectHub: (origin: string) => Promise<void>
  onConnect: () => void
  onDisconnected?: () => void
  connectionButtonRef?: RefObject<HTMLButtonElement | null>
  connecting?: boolean
  publication?: Publication
  publicationBusy?: boolean
  dirty?: boolean
  onPublish?: () => void
  onRetryPublication?: () => void
  publishPreference?: ReturnType<typeof usePublishPreference>
  open: boolean
  onClose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reviewRoute(value: unknown): ReviewRoute | null {
  if (
    !isRecord(value) ||
    typeof value.pathname !== "string" ||
    typeof value.search !== "string" ||
    typeof value.hash !== "string"
  )
    return null
  return { pathname: value.pathname, search: value.search, hash: value.hash }
}

export function HubPanel({
  config,
  frameRef,
  onRouteChange,
  status,
  onStatusChange,
  onSelectHub,
  onConnect,
  onDisconnected,
  connectionButtonRef,
  connecting = false,
  publication,
  publicationBusy = false,
  dirty = false,
  onPublish,
  onRetryPublication,
  publishPreference,
  open,
  onClose,
}: Props) {
  const [commentState, setCommentState] = useState<{ identity: string; items: ReviewComment[] }>({
    identity: "",
    items: [],
  })
  const mentionRepositoryId = status?.prototype?.repositoryId
  const mentionPrototypeId = status?.prototype?.id
  const mentionConnected = status?.state === "connected"
  const mentionHubOrigin = status?.hubOrigin
  const mentionSource = useMemo(
    () => ({
      load: async () => {
        if (!mentionConnected || !mentionHubOrigin) throw new Error(copy.mentionSuggestionsError)

        return MENTION_CANDIDATES_SCHEMA.parse(
          await request(
            `/api/hub/mention-candidates?repositoryId=${mentionRepositoryId}&prototypeId=${mentionPrototypeId}`,
            config.token,
          ),
        ).candidates
      },
      copy: {
        suggestions: copy.mentionSuggestions,
        error: copy.mentionSuggestionsError,
        loading: copy.mentionSuggestionsLoading,
        empty: copy.mentionSuggestionsEmpty,
        retry: reviewCommentsCopy.retryLabel,
        limit: copy.mentionLimit,
      },
    }),
    [config.token, mentionConnected, mentionHubOrigin, mentionRepositoryId, mentionPrototypeId],
  )
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_REVIEW_COMMENT_FILTERS)
  const [showPins, setShowPins] = useState(true)
  const [previewRoute, setPreviewRoute] = useState<ReviewRoute | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [rateLimitMessage, setRateLimitMessage] = useState("")
  const [disconnectWarning, setDisconnectWarning] = useState("")
  const [loading, setLoading] = useState(false)
  const [commentsLoadFailed, setCommentsLoadFailed] = useState(false)
  const [hubEditorOpen, setHubEditorOpen] = useState(false)
  const [hubOrigin, setHubOrigin] = useState(
    (status?.discovery?.mismatch && status.discovery.origin) || status?.hubOrigin || "",
  )
  const [savingHub, setSavingHub] = useState(false)
  const [resettingHub, setResettingHub] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [startPage, setStartPage] = useState("")
  const [editing, setEditing] = useState(false)
  const [draftIdentity, setDraftIdentity] = useState<string | null>(null)
  const [draftActive, setDraftActive] = useState(false)
  const [markers, setMarkers] = useState<
    Map<
      number,
      {
        x: number
        y: number
        rect: { x: number; y: number; width: number; height: number }
      }
    >
  >(new Map())
  const [bridgeReady, setBridgeReady] = useState(false)
  const [bridgeProblem, setBridgeProblem] = useState("")
  const [selectionMode, setSelectionMode] = useState<"element" | "area" | null>(null)
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null)
  const [selectionFailure, setSelectionFailure] = useState<
    "element-unavailable" | "area-too-small" | "area-unavailable" | null
  >(null)
  const [liveError, setLiveError] = useState(false)
  const [mutation, setMutation] = useState<ReviewCommentMutation | null>(null)
  const mutationRef = useRef(false)
  const reactionRevisionRef = useRef(0)
  const reactionPendingRef = useRef(false)
  const bridgeNonceRef = useRef("")
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const identityRef = useRef("")
  const previousOpenRef = useRef(open)
  const refreshTimer = useRef<number | undefined>(undefined)
  const identity = `${status?.hubOrigin ?? ""}/${status?.repository ?? ""}/${status?.branch ?? ""}/${status?.state === "connected" ? (status.prototype?.id ?? "") : ""}`
  const selectedHubOrigin = status
    ? (status.discovery?.mismatch && status.discovery.origin) || status.hubOrigin || ""
    : null
  const previousHubOrigin = useRef(selectedHubOrigin)
  const hubState = status?.state
  const hubStatusFailed = hubState === "unavailable" || hubState === "denied"
  const previousHubState = useRef(hubState)
  useEffect(() => {
    if (selectedHubOrigin === null || previousHubOrigin.current === selectedHubOrigin) return
    const initial = window.setTimeout(() => {
      setHubOrigin(selectedHubOrigin)
      previousHubOrigin.current = selectedHubOrigin
    }, 0)
    return () => window.clearTimeout(initial)
  }, [selectedHubOrigin])
  useEffect(() => {
    if (!hubState || previousHubState.current === hubState) return
    if (hubState !== "connected" && hubState !== "undiscovered") {
      previousHubState.current = hubState
      return
    }
    const initial = window.setTimeout(() => {
      setHubEditorOpen(false)
      previousHubState.current = hubState
    }, 0)
    return () => window.clearTimeout(initial)
  }, [hubState])

  const commentingRecovery = useCommentingRecovery({
    identity,
    enabled: status?.repositoryAuthorized === true,
    ready: bridgeReady,
    bridgeProblem,
    token: config.token,
  })
  const comments = useMemo(
    () => (commentState.identity === identity ? commentState.items : []),
    [commentState, identity],
  )
  const threads = useMemo(() => groupReviewCommentsIntoThreads(comments), [comments])
  const participants = useMemo(() => {
    const byLogin = new Map(
      threads.flatMap((thread) =>
        thread.participants.map((participant) => [participant.login.toLowerCase(), participant]),
      ),
    )
    return Array.from(byLogin.values()).sort((first, second) =>
      (first.name || first.login).localeCompare(second.name || second.login),
    )
  }, [threads])
  const markerResolutions = useMemo(() => {
    const resolutions = new Map<number, AnchorResolution>()
    for (const thread of threads) {
      const commentId = thread.root.id
      const point = markers.get(commentId)
      if (point) {
        resolutions.set(commentId, {
          commentId,
          status: "resolved" as const,
          point,
          rect: point.rect,
        })
      } else if (bridgeReady) {
        const route = thread.root.anchor.route
        resolutions.set(commentId, {
          commentId,
          status:
            previewRoute &&
            (route.pathname !== previewRoute.pathname ||
              route.search !== previewRoute.search ||
              route.hash !== previewRoute.hash)
              ? ("route-mismatch" as const)
              : ("missing" as const),
        })
      }
    }
    return resolutions
  }, [bridgeReady, markers, previewRoute, threads])
  const active =
    status?.state === "connected" ? threads.find((thread) => thread.root.id === selected) : null
  const prototype = status?.state === "connected" ? status.prototype : null
  const needsConnection =
    status?.state === "disconnected" ||
    status?.state === "pairing" ||
    status?.state === "unconfigured"
  const buildAuthorLogin = prototype?.build?.author.login
  const buildAuthorProfileUrl =
    buildAuthorLogin &&
    /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(?:\[bot\])?$/i.test(buildAuthorLogin)
      ? `https://github.com/${encodeURIComponent(buildAuthorLogin)}`
      : null
  const buildAuthorLabel =
    prototype?.build?.author.name?.trim() ||
    (buildAuthorProfileUrl ? buildAuthorLogin : null) ||
    copy.unknownCommitAuthor
  const canManage = prototype?.canEdit && prototype.registered
  const prototypeId = prototype?.id
  const currentBuild = prototype?.build ?? null
  const visibleThreads = useMemo(
    () =>
      prototype
        ? threads.filter((thread) =>
            reviewThreadMatchesFilters(thread, {
              filters,
              viewerLogin: prototype.viewerLogin,
              selectedBuildNumber: currentBuild?.number,
              route: previewRoute,
            }),
          )
        : threads,
    [currentBuild?.number, filters, previewRoute, prototype, threads],
  )
  const visibleThreadCount = visibleThreads.length
  const hasUnreadVisibleThreads = visibleThreads.some((thread) => thread.unread)
  const canCreateComment = Boolean(
    currentBuild && status?.commitSha && status.commitSha === currentBuild.commitSha,
  )
  const selectionBlocked = selectedAnchor !== null || draftActive || mutation !== null
  const hubVisible = open && !commentsOpen
  const reviewControlsTarget =
    typeof document === "undefined" ? null : document.getElementById("canvas-review-controls")
  const selectedAnchorPoint = selectedAnchor
    ? selectedAnchor.kind === "element"
      ? {
          x:
            selectedAnchor.rect.x -
            selectedAnchor.viewport.scrollX +
            selectedAnchor.rect.width * selectedAnchor.elementOffset.x,
          y:
            selectedAnchor.rect.y -
            selectedAnchor.viewport.scrollY +
            selectedAnchor.rect.height * selectedAnchor.elementOffset.y,
        }
      : getAreaAnchorGeometry(selectedAnchor, {
          x: selectedAnchor.rect.x - selectedAnchor.viewport.scrollX,
          y: selectedAnchor.rect.y - selectedAnchor.viewport.scrollY,
          width: selectedAnchor.rect.width,
          height: selectedAnchor.rect.height,
        }).point
    : null
  useLayoutEffect(() => {
    identityRef.current = identity
    return () => window.clearTimeout(refreshTimer.current)
  }, [identity])
  useLayoutEffect(() => {
    if (open) closeButtonRef.current?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open
    if (!open || wasOpen || !commentsOpen) return
    if (draftActive) {
      onClose()
      return
    }
    const timeout = window.setTimeout(() => {
      setCommentsOpen(false)
      setSelected(null)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [commentsOpen, draftActive, onClose, open])
  useEffect(() => {
    if (!open) return
    function handleEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], dialog, [role="menu"]'))
      )
        return
      event.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open, onClose])
  const editingCurrent = editing && draftIdentity === identity
  const anchorKey = JSON.stringify(
    config.pickAndPolish || config.improvementNotesDemo
      ? []
      : threads.slice(0, 200).map(({ root }) => ({ id: root.id, anchor: root.anchor })),
  )

  const loadComments = useCallback(async () => {
    if (!prototypeId || reactionPendingRef.current) return
    const requestedIdentity = identity
    const reactionRevision = reactionRevisionRef.current
    setLoading(true)
    try {
      const loaded: ReviewComment[] = []
      let nextCursor: string | null = null
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const page = REVIEW_COMMENT_PAGE_SCHEMA.parse(
          await request(
            `/api/hub/comments${nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ""}`,
            config.token,
          ),
        )
        loaded.push(...page.comments)
        nextCursor = page.nextCursor
        if (!nextCursor) break
        if (pageNumber === 99) throw new Error("Too many review comment pages.")
      }
      if (
        identityRef.current !== requestedIdentity ||
        reactionRevisionRef.current !== reactionRevision
      )
        return
      setCommentState({ identity: requestedIdentity, items: loaded })
      setCommentsLoadFailed(false)
      setError("")
    } catch (cause) {
      if (
        identityRef.current === requestedIdentity &&
        reactionRevisionRef.current === reactionRevision
      ) {
        setCommentsLoadFailed(true)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (
        identityRef.current === requestedIdentity &&
        reactionRevisionRef.current === reactionRevision
      ) {
        setLoading(false)
      }
    }
  }, [config.token, prototypeId, identity])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setCommentState({ identity, items: [] })
      setCommentsOpen(false)
      setFilters(DEFAULT_REVIEW_COMMENT_FILTERS)
      setShowPins(true)
      setPreviewRoute(null)
      setSelected(null)
      setDraftActive(false)
      setEditing(false)
      setDraftIdentity(null)
      setName("")
      setDescription("")
      setMutation(null)
      mutationRef.current = false
      reactionPendingRef.current = false
      reactionRevisionRef.current += 1
      setMarkers(new Map())
      setBridgeReady(false)
      setSelectionMode(null)
      setSelectedAnchor(null)
      setSelectionFailure(null)
      setRateLimitMessage("")
      setCommentsLoadFailed(false)
      if (prototypeId) void loadComments()
    }, 0)
    return () => window.clearTimeout(initial)
  }, [identity, prototypeId, loadComments])

  useEffect(() => {
    if (!prototypeId) return
    const interval = window.setInterval(() => void loadComments(), 30_000)
    return () => window.clearInterval(interval)
  }, [prototypeId, loadComments])

  useEffect(() => {
    if (!prototypeId) return
    const controller = new AbortController()
    let retry: number
    let retryDelay = 5_000
    async function listen() {
      const startedAt = Date.now()
      try {
        const response = await fetch("/api/hub/events", {
          headers: { "X-Replica-Canvas-Token": config.token },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error("Live review connection unavailable.")
        setLiveError(false)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = ""
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read()
          if (done) throw new Error("Live review connection closed.")
          text += decoder.decode(value, { stream: true })
          const events = text.split("\n\n")
          text = events.pop() || ""
          for (const event of events) {
            if (event.startsWith("event: comments\n")) void loadComments()
            if (event.startsWith("event: error\n"))
              throw new Error("Live review connection failed.")
          }
        }
      } catch {
        if (!controller.signal.aborted) setLiveError(true)
      }
      if (!controller.signal.aborted) {
        if (Date.now() - startedAt >= 30_000) retryDelay = 5_000
        retry = window.setTimeout(() => void listen(), retryDelay)
        retryDelay = Math.min(retryDelay * 2, 60_000)
      }
    }
    void listen()
    return () => {
      controller.abort()
      window.clearTimeout(retry)
    }
  }, [identity, prototypeId, config.token, loadComments])

  const sendBridge = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const frame = frameRef.current
      if (!frame?.contentWindow || !bridgeNonceRef.current) return false
      frame.contentWindow.postMessage(
        { type, nonce: bridgeNonceRef.current, ...payload },
        new URL(config.previewUrl ?? config.prototypeUrl).origin,
      )
      return true
    },
    [config.prototypeUrl, config.previewUrl, frameRef],
  )

  const startSelection = useCallback(
    (mode: "element" | "area") => {
      if (
        config.pickAndPolish ||
        config.improvementNotesDemo ||
        !bridgeReady ||
        !canCreateComment ||
        selectionBlocked
      )
        return
      setSelected(null)
      setSelectionFailure(null)
      setSelectionMode(mode)
      onClose()
      sendBridge("replica:canvas:select", { mode })
    },
    [
      config.improvementNotesDemo,
      config.pickAndPolish,
      bridgeReady,
      canCreateComment,
      onClose,
      selectionBlocked,
      sendBridge,
    ],
  )

  const cancelSelection = useCallback(() => {
    if (!selectionMode) return
    sendBridge("replica:canvas:cancel-selection")
    setSelectionMode(null)
  }, [selectionMode, sendBridge])

  const clearSelection = useCallback(() => {
    sendBridge("replica:canvas:clear-selection")
    setSelectedAnchor(null)
    setSelectionFailure(null)
  }, [sendBridge])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) {
      setMarkers(new Map())
      setBridgeReady(false)
      return
    }
    const origin = new URL(config.previewUrl ?? config.prototypeUrl).origin
    const anchors = JSON.parse(anchorKey) as { id: number; anchor: unknown }[]
    const anchorIds = new Set(anchors.map(({ id }) => id))
    let lastResponse = Date.now()
    let incompatible = false
    function requestBridgeState() {
      bridgeNonceRef.current = crypto.randomUUID()
      lastResponse = Date.now()
      incompatible = false
      setBridgeReady(false)
      setBridgeProblem("")
      setMarkers(new Map())
      frame?.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce: bridgeNonceRef.current },
        origin,
      )
      resolveAnchors()
    }
    function resolveAnchors() {
      if (anchors.length)
        frame?.contentWindow?.postMessage(
          {
            type: "replica:canvas:resolve",
            nonce: bridgeNonceRef.current,
            anchors,
          },
          origin,
        )
    }
    function receive(event: MessageEvent) {
      const data: unknown = event.data
      if (
        event.source !== frame?.contentWindow ||
        event.origin !== origin ||
        !isRecord(data) ||
        data.nonce !== bridgeNonceRef.current
      )
        return
      if (data.type === "replica:canvas:bridge-error") {
        setBridgeReady(false)
        setBridgeProblem(copy.commentingMissing)
        return
      }
      if (data.type === "replica:canvas:ready") {
        if (data.protocolVersion !== 1) {
          incompatible = true
          setBridgeReady(false)
          setBridgeProblem(copy.commentingIncompatible)
          return
        }
        if (!reviewRoute(data.route)) return
        lastResponse = Date.now()
        incompatible = false
        setBridgeReady(true)
        setBridgeProblem("")
        setPreviewRoute(reviewRoute(data.route))
        onRouteChange?.(reviewRoute(data.route)!, data.replaceRoute === true)
        return
      }
      if (incompatible) return
      if (data.type === "replica:canvas:conversation-dismiss-requested") {
        window.dispatchEvent(new Event("replica:review-dismiss"))
        return
      }
      if (data.type === "replica:canvas:resolved") {
        if (data.protocolVersion !== 1 || !reviewRoute(data.route)) return
        if (!Array.isArray(data.results) || data.results.length > 200) return
        lastResponse = Date.now()
        setBridgeReady(true)
        setBridgeProblem("")
        setPreviewRoute(reviewRoute(data.route))
        onRouteChange?.(reviewRoute(data.route)!, data.replaceRoute === true)
        const next = new Map<
          number,
          {
            x: number
            y: number
            rect: { x: number; y: number; width: number; height: number }
          }
        >()
        for (const entry of data.results as unknown[]) {
          if (
            !isRecord(entry) ||
            typeof entry.id !== "number" ||
            typeof entry.x !== "number" ||
            typeof entry.y !== "number" ||
            !anchorIds.has(entry.id) ||
            !Number.isFinite(entry.x) ||
            !Number.isFinite(entry.y) ||
            entry.x < 0 ||
            entry.y < 0 ||
            entry.x > frame.clientWidth ||
            entry.y > frame.clientHeight
          )
            continue
          const rect =
            isRecord(entry.rect) &&
            typeof entry.rect.x === "number" &&
            typeof entry.rect.y === "number" &&
            typeof entry.rect.width === "number" &&
            typeof entry.rect.height === "number" &&
            Number.isFinite(entry.rect.x) &&
            Number.isFinite(entry.rect.y) &&
            Number.isFinite(entry.rect.width) &&
            Number.isFinite(entry.rect.height) &&
            entry.rect.width >= 0 &&
            entry.rect.height >= 0
              ? {
                  x: entry.rect.x,
                  y: entry.rect.y,
                  width: entry.rect.width,
                  height: entry.rect.height,
                }
              : { x: entry.x, y: entry.y, width: 0, height: 0 }
          next.set(entry.id, { x: entry.x, y: entry.y, rect })
        }
        setMarkers(next)
        return
      }
      if (data.type === "replica:canvas:selected") {
        if (config.pickAndPolish || config.improvementNotesDemo) return
        const parsed = REVIEW_ANCHOR_SCHEMA.safeParse(data.anchor)
        if (!parsed.success) {
          sendBridge("replica:canvas:cancel-selection")
          sendBridge("replica:canvas:clear-selection")
          setSelectionMode(null)
          setSelectionFailure(
            isRecord(data.anchor) && data.anchor.kind === "area"
              ? "area-unavailable"
              : "element-unavailable",
          )
          return
        }
        setSelectedAnchor(parsed.data)
        setSelectionMode(null)
        setSelectionFailure(null)
        return
      }
      if (
        data.type === "replica:canvas:selection-failed" &&
        (data.reason === "element-unavailable" ||
          data.reason === "area-too-small" ||
          data.reason === "area-unavailable")
      ) {
        setSelectionMode(null)
        setSelectionFailure(data.reason)
        return
      }
      if (data.type === "replica:canvas:selection-cancelled") {
        setSelectionMode(null)
        return
      }
    }
    function onFrameLoad() {
      setSelectionMode(null)
      setSelectedAnchor(null)
      setSelectionFailure(null)
      requestBridgeState()
    }
    frame.addEventListener("load", onFrameLoad)
    window.addEventListener("message", receive)
    requestBridgeState()
    const interval = window.setInterval(() => {
      if (Date.now() - lastResponse >= 20_000) {
        setBridgeReady(false)
        setMarkers(new Map())
        setBridgeProblem(incompatible ? copy.commentingIncompatible : copy.commentingMissing)
      }
      frame.contentWindow?.postMessage(
        { type: "replica:canvas:request-ready", nonce: bridgeNonceRef.current },
        origin,
      )
      resolveAnchors()
    }, 2_000)
    return () => {
      frame.removeEventListener("load", onFrameLoad)
      window.removeEventListener("message", receive)
      window.clearInterval(interval)
    }
  }, [
    identity,
    anchorKey,
    config.prototypeUrl,
    config.improvementNotesDemo,
    config.pickAndPolish,
    config.previewUrl,
    frameRef,
    onRouteChange,
    sendBridge,
  ])

  async function change(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: object,
    action?: ReviewCommentMutation,
  ) {
    const requestedIdentity = identity
    const reaction = action?.kind === "add-reaction" || action?.kind === "remove-reaction"
    if (action) {
      if (mutationRef.current) return false
      mutationRef.current = true
      setMutation(action)
    }
    if (reaction) {
      reactionPendingRef.current = true
      reactionRevisionRef.current += 1
    }
    setRateLimitMessage("")
    try {
      const result = await request(`/api/hub/comments/${path}`, config.token, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (identityRef.current !== requestedIdentity) return false
      if (reaction) {
        const changed = REVIEW_COMMENT_MUTATION_SCHEMA.parse(result)
        setCommentState((previous) => {
          if (previous.identity !== requestedIdentity) return previous
          const merged = new Map(previous.items.map((comment) => [comment.id, comment]))
          for (const comment of changed.comments) merged.set(comment.id, comment)
          return { identity: requestedIdentity, items: [...merged.values()] }
        })
      }
      // Let the conversation clear its saved draft before updating the thread.
      if (!reaction) refreshTimer.current = window.setTimeout(() => void loadComments(), 0)
      return true
    } catch (cause) {
      if (identityRef.current === requestedIdentity) {
        setError(cause instanceof Error ? cause.message : String(cause))
        if (cause instanceof Error && "statusCode" in cause && cause.statusCode === 429)
          setRateLimitMessage(cause.message)
      }
      return false
    } finally {
      if (action && identityRef.current === requestedIdentity) {
        if (reaction) {
          reactionPendingRef.current = false
          reactionRevisionRef.current += 1
          refreshTimer.current = window.setTimeout(() => void loadComments(), 0)
        }
        mutationRef.current = false
        setMutation(null)
      }
    }
  }

  async function createComment(body: string) {
    if (!currentBuild || !selectedAnchor || mutationRef.current) return false
    const requestedIdentity = identity
    mutationRef.current = true
    setMutation({ kind: "create" })
    setRateLimitMessage("")
    try {
      const result = REVIEW_COMMENT_MUTATION_SCHEMA.parse(
        await request("/api/hub/comments", config.token, {
          method: "POST",
          body: JSON.stringify({
            review_comment: {
              build_number: currentBuild.number,
              body,
              anchor: selectedAnchor,
            },
          }),
        }),
      )
      if (identityRef.current !== requestedIdentity) return false
      const root = result.comments.find((comment) => comment.kind === "root")
      if (!root) return false
      setCommentState((previous) => {
        if (previous.identity !== requestedIdentity) return previous
        const merged = new Map(previous.items.map((comment) => [comment.id, comment]))
        for (const comment of result.comments) merged.set(comment.id, comment)
        return { identity: requestedIdentity, items: [...merged.values()] }
      })
      clearSelection()
      setSelected(root.id)
      return true
    } catch (cause) {
      if (identityRef.current === requestedIdentity) {
        setError(cause instanceof Error ? cause.message : String(cause))
        if (cause instanceof Error && "statusCode" in cause && cause.statusCode === 429)
          setRateLimitMessage(cause.message)
      }
      return false
    } finally {
      if (identityRef.current === requestedIdentity) {
        mutationRef.current = false
        setMutation(null)
      }
    }
  }

  function toggleComments() {
    if (selectionBlocked) return
    if (commentsOpen) {
      setSelected(null)
      setCommentsOpen(false)
      return
    }
    setCommentsOpen(true)
    if (open) onClose()
  }

  const branchUrl =
    status?.repository && status.branch
      ? `https://github.com/${status.repository
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")}/tree/${encodeURIComponent(status.branch)}`
      : null
  const branchControl =
    status?.branch && branchUrl ? (
      <a
        className="canvas-hub-publication__branch"
        href={branchUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${status.branch} on GitHub`}
      >
        <GitBranchIcon size={16} aria-hidden="true" />
        <span>{status.branch}</span>
      </a>
    ) : status?.branch ? (
      <span className="canvas-hub-publication__branch">
        <GitBranchIcon size={16} aria-hidden="true" />
        <span>{status.branch}</span>
      </span>
    ) : null

  const hubOriginControls = (
    <>
      <Heading as="h3" size="subhead-medium" id="canvas-hub-origin-title">
        Hub
      </Heading>
      {status && status.state !== "unconfigured" ? (
        <div className="canvas-hub-origin">
          {status.hubOrigin ? (
            <a
              href={
                prototype
                  ? new URL(
                      `/repositories/${prototype.repositoryId}/prototypes/${prototype.id}`,
                      status.hubOrigin,
                    ).href
                  : status.hubOrigin
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {status.hubOrigin}
            </a>
          ) : (
            <span>URL unavailable</span>
          )}
        </div>
      ) : null}
      {hubEditorOpen || status?.state === "disconnected" || status?.state === "unconfigured" ? (
        <form
          className="canvas-hub-origin-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (savingHub || resettingHub) return
            setSavingHub(true)
            setHubEditorOpen(true)
            setError("")
            void onSelectHub(hubOrigin)
              .then(() => {
                setHubEditorOpen(false)
              })
              .catch((cause: Error) => setError(cause.message))
              .finally(() => setSavingHub(false))
          }}
        >
          <div className="canvas-hub-origin-field">
            <label>
              {copy.hubUrl}
              <input
                type="url"
                required
                value={hubOrigin}
                placeholder="https://hub.example.com"
                disabled={savingHub || resettingHub}
                onChange={(event) => setHubOrigin(event.target.value)}
              />
            </label>
            <Button
              type="button"
              size="small"
              variant="subtle"
              className="canvas-icon-button"
              leadingVisual={<SyncIcon size={16} />}
              aria-label={copy.resetHubUrl}
              title={copy.resetHubUrl}
              disabled={savingHub || resettingHub}
              aria-busy={resettingHub}
              onClick={() => {
                setResettingHub(true)
                setError("")
                void request<HubStatus>("/api/hub/discovery", config.token, {
                  method: "POST",
                  body: "{}",
                })
                  .then(async (next) => {
                    if (next.discovery?.state !== "valid" || !next.discovery.origin)
                      throw new Error(next.discovery?.message || copy.resetHubUnavailable)
                    setHubOrigin(next.discovery.origin)
                    await onStatusChange()
                  })
                  .catch((cause: Error) => setError(cause.message))
                  .finally(() => setResettingHub(false))
              }}
            >
              <span className="visually-hidden">{copy.resetHubUrl}</span>
            </Button>
          </div>
          <p>{copy.hubHttpsHint}</p>
          <div className="canvas-hub-form-actions">
            <Button type="submit" size="small" disabled={savingHub || resettingHub}>
              Save Hub
            </Button>
            {hubEditorOpen &&
            status?.state !== "unconfigured" &&
            status?.state !== "disconnected" ? (
              <Button
                type="button"
                size="small"
                variant="subtle"
                disabled={savingHub || resettingHub}
                onClick={() => setHubEditorOpen(false)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </>
  )

  return (
    <MentionProvider source={mentionSource}>
      {commentingRecovery.visible ? <CommentingRecovery {...commentingRecovery} /> : null}
      {prototype && reviewControlsTarget && !config.pickAndPolish && !config.improvementNotesDemo
        ? createPortal(
            <div
              className="canvas-review-controls review-shell__comment-actions"
              role="group"
              aria-label={reviewCommentsCopy.heading}
            >
              <ReviewCommentControl
                bridgeReady={bridgeReady && canCreateComment}
                copy={reviewCommentsCopy}
                selectionBlocked={selectionBlocked}
                selecting={selectionMode !== null}
                onCancelSelection={cancelSelection}
                onStartAreaSelection={() => startSelection("area")}
                onStartElementSelection={() => startSelection("element")}
              />
              <Tooltip
                text={
                  selectionBlocked
                    ? reviewCommentsCopy.selectionBlockedLabel
                    : `${reviewCommentsCopy.heading} (${reviewCommentsCopy.sidebarShortcutLabel})`
                }
                type="description"
              >
                <Button
                  className="canvas-comments-toggle review-shell__comments-toggle"
                  variant="secondary"
                  size="small"
                  aria-label={`${reviewCommentsCopy.heading}, ${visibleThreadCount}${hasUnreadVisibleThreads ? `, ${reviewCommentsCopy.unreadLabel}` : ""}`}
                  aria-expanded={commentsOpen}
                  aria-keyshortcuts="Shift+C"
                  disabled={!currentBuild || selectionBlocked}
                  onClick={toggleComments}
                >
                  <HubCounter>{visibleThreadCount}</HubCounter>
                  {hasUnreadVisibleThreads ? (
                    <span
                      className="canvas-comments-unread-badge review-shell__unread-badge"
                      aria-hidden="true"
                    />
                  ) : null}
                </Button>
              </Tooltip>
            </div>,
            reviewControlsTarget,
          )
        : null}
      {showPins && visibleThreads.length && bridgeReady ? (
        <div className="canvas-marker-layer">
          <ReviewCommentMarkers
            threads={visibleThreads}
            resolutions={markerResolutions}
            selectedThreadId={selected}
            selectionBlocked={draftActive}
            focusSelectedMarker={false}
            showAreaHighlightsOnlyWhenSelected
            copy={reviewCommentsCopy}
            onSelect={(thread) => setSelected(thread.root.id)}
          />
        </div>
      ) : null}
      <HubSidebar
        className="canvas-hub-panel"
        contentClassName="canvas-hub-content"
        title="Replica Hub"
        label="Hub"
        open={hubVisible}
        closeLabel="Close Hub"
        closeRef={closeButtonRef}
        onClose={onClose}
      >
        {error ? <p role="alert">{error}</p> : null}
        {disconnectWarning ? <p role="alert">{disconnectWarning}</p> : null}
        {!status ? <p>Checking Hub connection…</p> : null}
        {!needsConnection && !hubStatusFailed && status?.message ? (
          <p role="status">{status.message}</p>
        ) : null}
        {hubStatusFailed ? (
          <div className="canvas-hub-status">
            <HubAlert
              variant="warning"
              layout="compact"
              title={status?.message || publicationCopy.hubUnavailable}
            />
            <Button
              variant="primary"
              size="small"
              disabled={publicationBusy}
              aria-busy={publicationBusy}
              leadingVisual={publicationBusy ? <SyncIcon size={16} /> : undefined}
              onClick={onRetryPublication || (() => void onStatusChange())}
            >
              {publicationCopy.retry}
            </Button>
          </div>
        ) : null}
        {!needsConnection && !hubStatusFailed && publication && onPublish && onRetryPublication ? (
          <BranchPublication
            publication={publication}
            busy={publicationBusy}
            dirty={dirty}
            onPublish={onPublish}
            onRetry={onRetryPublication}
          />
        ) : null}
        {needsConnection ? (
          <section className="canvas-hub-connection">
            <p>{copy.connectionBeforePublishing}</p>
            <Button
              ref={connectionButtonRef}
              variant="primary"
              onClick={onConnect}
              disabled={connecting}
            >
              {connecting ? copy.connectionOpeningBrowser : copy.connectToHub}
            </Button>
          </section>
        ) : null}
        {!needsConnection &&
        ((!hubEditorOpen &&
          (status?.discovery?.mismatch ||
            ["invalid", "unreachable"].includes(status?.discovery?.state || ""))) ||
          status?.state === "unconfigured") ? (
          <div className="canvas-hub-settings">
            {!hubEditorOpen && status?.discovery?.mismatch ? (
              <p role="alert">
                The repository configuration differs from your selected Hub. Your connection has not
                changed. Disconnect Hub before selecting another URL.
              </p>
            ) : null}
            {!hubEditorOpen &&
            ["invalid", "unreachable"].includes(status?.discovery?.state || "") ? (
              <p role="alert">{status?.discovery?.message}</p>
            ) : null}
            {status?.state === "unconfigured" ? <p>Enter your Hub URL to connect.</p> : null}
          </div>
        ) : null}
        {status?.state === "undiscovered" && !publication ? (
          <p>
            Connected to {status.repository}. Hub has not discovered{" "}
            {status.branch || "a prototype branch"}. Your repository connection is ready. Push a
            named branch to make its Builds and reviews available.
          </p>
        ) : null}
        {prototype ? (
          <>
            <section
              className={
                publication && publication.kind !== "ready" && onPublish && onRetryPublication
                  ? "canvas-hub-publication canvas-hub-publication--after-status"
                  : "canvas-hub-publication"
              }
              aria-label="Prototype"
            >
              {canManage && editingCurrent ? (
                <form
                  className="canvas-hub-publication__form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void request("/api/hub/metadata", config.token, {
                      method: "PATCH",
                      body: JSON.stringify({ name, description, startPage }),
                    })
                      .then(async () => {
                        setEditing(false)
                        await onStatusChange()
                      })
                      .catch((cause: Error) => setError(cause.message))
                  }}
                >
                  <div className="canvas-hub-publication__title">
                    <label className="canvas-hub-publication__name-field">
                      <span className="visually-hidden">Name</span>
                      <input
                        required
                        maxLength={255}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <span className="canvas-hub-publication__status">
                      {prototype.published
                        ? "Published"
                        : prototype.registered
                          ? "Registered"
                          : "Not registered"}
                    </span>
                  </div>
                  {branchControl}
                  <label className="canvas-hub-publication__description-field">
                    <span className="visually-hidden">Description</span>
                    <textarea
                      value={description}
                      placeholder="Add a description"
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  <label className="canvas-hub-publication__start-page-field">
                    {copy.startPage}
                    <input
                      value={startPage}
                      placeholder="/"
                      aria-describedby="canvas-start-page-hint"
                      onChange={(event) => setStartPage(event.target.value)}
                    />
                  </label>
                  <p id="canvas-start-page-hint" className="canvas-hub-publication__hint">
                    {copy.startPageHint}
                  </p>
                  <div className="canvas-hub-form-actions">
                    <Button type="submit" size="small">
                      Save metadata
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="subtle"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="canvas-hub-publication__title">
                    <Heading as="h3" size="subhead-large">
                      {prototype.name || status?.branch}
                    </Heading>
                    <span className="canvas-hub-publication__status">
                      {prototype.published
                        ? "Published"
                        : prototype.registered
                          ? "Registered"
                          : "Not registered"}
                    </span>
                  </div>
                  {branchControl}
                  {prototype.description ? (
                    <p className="canvas-hub-publication__description">{prototype.description}</p>
                  ) : null}
                  <p className="canvas-hub-publication__description canvas-hub-publication__start-page">
                    {copy.startPage}: <code>{prototype.startPage || "/"}</code>
                  </p>
                  {canManage ? (
                    <Button
                      size="small"
                      variant="subtle"
                      onClick={() => {
                        setName(prototype.name || "")
                        setDescription(prototype.description || "")
                        setStartPage(prototype.startPage || "")
                        setDraftIdentity(identity)
                        setEditing(true)
                      }}
                    >
                      {copy.editDetails}
                    </Button>
                  ) : null}
                </>
              )}
            </section>
            <section className="canvas-hub-section" aria-labelledby="canvas-hub-build-title">
              <Heading as="h3" size="subhead-medium" id="canvas-hub-build-title">
                {copy.latestBuild}
              </Heading>
              {prototype.build ? (
                <div className="canvas-hub-build">
                  <div className="canvas-hub-build__identity">
                    <a href={prototype.build.url} target="_blank" rel="noopener noreferrer">
                      {copy.buildTitle(prototype.build.number)}
                    </a>
                    <code
                      title={prototype.build.commitSha}
                      aria-label={`${copy.buildCommit} ${prototype.build.commitSha}`}
                    >
                      {prototype.build.commitSha.slice(0, 7)}
                    </code>
                  </div>
                  <p>
                    {buildAuthorProfileUrl ? (
                      <a
                        className="canvas-hub-build__author"
                        href={buildAuthorProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {buildAuthorLabel}
                      </a>
                    ) : (
                      <span>{buildAuthorLabel}</span>
                    )}
                  </p>
                  {status?.commitSha && status.commitSha !== prototype.build.commitSha ? (
                    <p className="canvas-hub-build__notice">
                      Local checkout differs from this Build
                    </p>
                  ) : null}
                </div>
              ) : (
                <p>
                  No successful imported Build yet. Current Build: {prototype.buildState || "none"}.
                </p>
              )}
              {prototype.build && status?.hubOrigin ? (
                <a
                  className="canvas-hub-build__history"
                  href={
                    new URL(
                      `/repositories/${prototype.repositoryId}/prototypes/${prototype.id}/builds`,
                      status.hubOrigin,
                    ).href
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {copy.showBuildHistory}
                </a>
              ) : null}
            </section>
          </>
        ) : null}
        {!needsConnection ? (
          <section className="canvas-hub-section" aria-labelledby="canvas-hub-origin-title">
            {hubOriginControls}
            {status?.hubOrigin &&
            ["connected", "undiscovered", "pairing", "denied", "unavailable"].includes(
              status.state,
            ) ? (
              <div className="canvas-hub-disconnect">
                <Button
                  size="small"
                  variant="subtle"
                  onClick={() => {
                    setDisconnectWarning("")
                    void request("/api/hub/disconnect", config.token, {
                      method: "POST",
                      body: "{}",
                    })
                      .then(async () => {
                        setHubOrigin(
                          (status.discovery?.mismatch && status.discovery.origin) ||
                            status.hubOrigin ||
                            "",
                        )
                        setHubEditorOpen(true)
                        await onStatusChange()
                        onDisconnected?.()
                      })
                      .catch((cause: Error) => {
                        setDisconnectWarning(
                          copy.disconnectFailed(status.hubOrigin || "", cause.message),
                        )
                        setHubOrigin(
                          (status.discovery?.mismatch && status.discovery.origin) ||
                            status.hubOrigin ||
                            "",
                        )
                        setHubEditorOpen(true)
                      })
                  }}
                >
                  Disconnect Hub
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
        {prototype?.registered && prototype.build && publishPreference ? (
          <PublishSettings preference={publishPreference} disabled={publicationBusy} />
        ) : null}
      </HubSidebar>
      {prototype ? (
        <ReviewCommentsSidebar
          frame={{
            open: commentsOpen,
            className: "canvas-comments-sidebar-shell",
            contentClassName: "canvas-comments-sidebar-content",
          }}
          threads={visibleThreads}
          currentBuildNumber={currentBuild?.number || 0}
          totalCount={visibleThreads.length}
          hasThreads={threads.length > 0}
          filters={filters}
          participants={participants}
          resolutions={markerResolutions}
          selectedThreadId={selected}
          selectionBlocked={selectionBlocked}
          closeBlocked={draftActive}
          showPins={showPins}
          loading={loading}
          loadFailed={commentsLoadFailed}
          notice={
            liveError || (currentBuild && !canCreateComment) ? (
              <div className="canvas-comments-live-notices">
                {liveError ? (
                  <p className="canvas-comments-live-status" role="status">
                    Live updates paused; checking every 30 seconds.
                  </p>
                ) : null}
                {currentBuild && !canCreateComment ? (
                  <p className="canvas-comments-live-status">
                    New comments are available when the local checkout matches Build #
                    {currentBuild.number}.
                  </p>
                ) : null}
              </div>
            ) : null
          }
          copy={reviewCommentsCopy}
          onClose={toggleComments}
          onFiltersChange={setFilters}
          onShowPinsChange={setShowPins}
          onRetry={() => void loadComments()}
          onSelect={(thread) => setSelected(thread.root.id)}
        />
      ) : null}
      <CanvasReviewOverlays
        selectionNotice={
          selectionFailure
            ? selectionFailure === "area-too-small"
              ? reviewCommentsCopy.areaTooSmallLabel
              : selectionFailure === "area-unavailable"
                ? reviewCommentsCopy.areaUnavailableLabel
                : reviewCommentsCopy.selectionFailedLabel
            : null
        }
        rateLimitNotice={rateLimitMessage && !hubVisible ? rateLimitMessage : null}
        composer={
          selectedAnchor && selectedAnchorPoint
            ? {
                anchorPoint: selectedAnchorPoint,
                bodyMaximumBytes: 10_000,
                copy: reviewCommentsCopy,
                creating: mutation?.kind === "create",
                onSubmit: createComment,
                onDiscard: clearSelection,
              }
            : null
        }
        conversation={
          active
            ? {
                thread: active,
                anchorPoint: markers.get(active.root.id) ?? null,
                bodyMaximumBytes: 10_000,
                mutation,
                copy: reviewCommentsCopy,
                onClose: () => setSelected(null),
                onDraftStateChange: setDraftActive,
                onReply: (body) =>
                  change(
                    `${active.root.id}/replies`,
                    "POST",
                    { review_comment: { body } },
                    {
                      kind: "reply",
                      commentId: active.root.id,
                    },
                  ),
                onEdit: (id, body) =>
                  change(
                    `${id}`,
                    "PATCH",
                    { review_comment: { body } },
                    { kind: "edit", commentId: id },
                  ),
                onDelete: (id) =>
                  change(`${id}`, "DELETE", undefined, { kind: "delete", commentId: id }),
                onResolve: () =>
                  change(`${active.root.id}/resolution`, "POST", undefined, {
                    kind: "resolve",
                    commentId: active.root.id,
                  }),
                onReopen: () =>
                  change(`${active.root.id}/resolution`, "DELETE", undefined, {
                    kind: "reopen",
                    commentId: active.root.id,
                  }),
                onAddReaction: (id, content: ReviewReactionContent) =>
                  change(
                    `${id}/reactions`,
                    "POST",
                    {
                      review_comment_reaction: {
                        content,
                        activity_version: active.root.activityVersion,
                      },
                    },
                    { kind: "add-reaction", commentId: id, content },
                  ),
                onRemoveReaction: (id, content: ReviewReactionContent) =>
                  change(
                    `${id}/reactions/${encodeURIComponent(content)}`,
                    "DELETE",
                    {
                      review_comment_reaction: { activity_version: active.root.activityVersion },
                    },
                    { kind: "remove-reaction", commentId: id, content },
                  ),
                onMarkRead: (version) =>
                  change(`${active.root.id}/read`, "POST", {
                    review_thread_read: { activity_version: version },
                  }),
              }
            : null
        }
      />
    </MentionProvider>
  )
}
