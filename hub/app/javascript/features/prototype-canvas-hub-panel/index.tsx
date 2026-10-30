import { GitBranchIcon, SyncIcon } from "@primer/octicons-react"
import { Button, Heading, Tooltip } from "@primer/react-brand/esm"
import {
  useCallback,
  useEffect,
  useEffectEvent,
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
  REVIEW_COMMENTS_SCHEMA,
} from "@utils/review-comment/schemas"
import type { ReviewComment, ReviewReactionContent } from "@utils/review-comment/types"
import type { ReviewCommentMutation } from "@hooks/use-review-comments/types"
import { reviewThreadMatchesFilters } from "@utils/review-thread-matches-filters"
import { MENTION_CANDIDATES_SCHEMA } from "@utils/mention-candidate/schemas"
import { request } from "@utils/prototype-canvas-request"
import { copy } from "@utils/prototype-canvas/en"
import { BranchPublication } from "@components/prototype-branch-publication"
import { CommentingRecovery } from "@components/prototype-commenting-recovery"
import { useCommentingRecovery } from "@hooks/use-canvas-commenting-recovery"
import { useReviewError } from "@hooks/use-review-error"
import type { Publication } from "@utils/resolve-prototype-publication"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"
import type { usePublishPreference } from "@hooks/use-canvas-publish-preference"
import type { CanvasConfig, HubStatus } from "@utils/prototype-canvas/types"

import { CanvasReviewOverlays } from "../prototype-review-overlays"
import { PublishSettings } from "../prototype-publish-settings"

import "./styles.css"

type Props = {
  config: CanvasConfig
  active?: boolean
  onActivate?: () => void
  selectionDisabled?: boolean
  onInteractionChange?: (blocked: boolean) => void
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

export function PrototypeCanvasHubPanel({
  config,
  active: reviewActive = true,
  onActivate,
  selectionDisabled = false,
  onInteractionChange,
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
  const [commentError, setCommentError] = useState("")
  useReviewError(commentError)
  const [createError, setCreateError] = useState("")
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
  const [preparingSelection, setPreparingSelection] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null)
  const [selectionFailure, setSelectionFailure] = useState<
    "element-unavailable" | "area-too-small" | "area-unavailable" | null
  >(null)
  const [liveError, setLiveError] = useState(false)
  useReviewError(status?.reviewError || status?.localCommentsError)
  useReviewError(liveError && copy.commentLiveUpdatesPaused)
  const [mutation, setMutation] = useState<ReviewCommentMutation | null>(null)
  const mutationRef = useRef(false)
  const commentMutationRevisionRef = useRef(0)
  const commentMutationPendingRef = useRef(false)
  const commentLoadRevisionRef = useRef(0)
  const commentIdentityRef = useRef("")
  const bridgeNonceRef = useRef("")
  const selectionRevisionRef = useRef<HubStatus["reviewRevision"]>(undefined)
  const selectionRequestRef = useRef(0)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const commentsButtonRef = useRef<HTMLButtonElement>(null)
  const restoreReviewFocusRef = useRef(false)
  const identityRef = useRef("")
  const previousOpenRef = useRef(open)
  const refreshTimer = useRef<number | undefined>(undefined)
  const identity = `${status?.hubOrigin ?? ""}/${status?.repository ?? ""}/${status?.branch ?? ""}/${status?.state === "connected" ? (status.prototype?.id ?? "") : ""}`
  const reviewRevision = status?.reviewRevision
  const draftRevisionId = reviewRevision?.id
  const commentIdentity = `${identity}/revision/${draftRevisionId ?? ""}`
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
    () => (commentState.identity === commentIdentity ? commentState.items : []),
    [commentState, commentIdentity],
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
  const active = threads.find((thread) => thread.root.id === selected)
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
  const viewerLogin = prototype?.viewerLogin || status?.viewerLogin
  const visibleThreads = useMemo(
    () =>
      viewerLogin
        ? threads.filter((thread) =>
            reviewThreadMatchesFilters(thread, {
              filters,
              viewerLogin,
              selectedBuildNumber: draftRevisionId ? null : currentBuild?.number,
              selectedDraftRevisionId: draftRevisionId,
              route: previewRoute,
            }),
          )
        : threads,
    [currentBuild?.number, draftRevisionId, filters, previewRoute, viewerLogin, threads],
  )
  const visibleThreadCount = visibleThreads.length
  const hasUnreadVisibleThreads = visibleThreads.some((thread) => thread.unread)
  const canCreateComment = Boolean(reviewRevision && !status?.reviewError)
  const canLoadComments =
    Boolean(status?.repositoryAuthorized && status.branch && status.viewerLogin) ||
    Boolean(prototype)
  const selectionBlocked =
    selectedAnchor !== null ||
    draftActive ||
    mutation !== null ||
    preparingSelection ||
    selectionDisabled
  useLayoutEffect(() => {
    onInteractionChange?.(
      selectedAnchor !== null ||
        draftActive ||
        mutation !== null ||
        preparingSelection ||
        selectionMode !== null ||
        selected !== null,
    )
  }, [
    selectedAnchor,
    draftActive,
    mutation,
    preparingSelection,
    selectionMode,
    selected,
    onInteractionChange,
  ])
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
    selectionRequestRef.current += 1
    restoreReviewFocusRef.current = false
    return () => window.clearTimeout(refreshTimer.current)
  }, [identity])
  useLayoutEffect(() => {
    commentIdentityRef.current = commentIdentity
    commentLoadRevisionRef.current += 1
  }, [commentIdentity])
  useLayoutEffect(() => {
    if (open) closeButtonRef.current?.focus({ preventScroll: true })
  }, [open])
  useLayoutEffect(() => {
    if (!selectedAnchor && !mutation && !draftActive && restoreReviewFocusRef.current) {
      restoreReviewFocusRef.current = false
      commentsButtonRef.current?.focus({ preventScroll: true })
    }
  }, [selectedAnchor, mutation, draftActive])
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
    reviewActive ? threads.map(({ root }) => ({ id: root.id, anchor: root.anchor })) : [],
  )

  const loadComments = useCallback(async () => {
    if (
      !canLoadComments ||
      commentMutationPendingRef.current ||
      commentIdentityRef.current !== commentIdentity
    )
      return
    const requestedIdentity = commentIdentity
    const loadRevision = ++commentLoadRevisionRef.current
    const commentMutationRevision = commentMutationRevisionRef.current
    setLoading(true)
    setCommentsLoadFailed(false)
    try {
      const collection = REVIEW_COMMENTS_SCHEMA.parse(
        await request(
          `/api/hub/comments${
            draftRevisionId
              ? `?${new URLSearchParams({ local_revision_id: String(draftRevisionId) })}`
              : ""
          }`,
          config.token,
        ),
      )
      if (
        commentIdentityRef.current !== requestedIdentity ||
        commentLoadRevisionRef.current !== loadRevision ||
        commentMutationRevisionRef.current !== commentMutationRevision
      )
        return
      setCommentState({ identity: requestedIdentity, items: collection.comments })
      setCommentsLoadFailed(false)
      setCommentError("")
    } catch (cause) {
      if (
        commentIdentityRef.current === requestedIdentity &&
        commentLoadRevisionRef.current === loadRevision &&
        commentMutationRevisionRef.current === commentMutationRevision
      ) {
        setCommentsLoadFailed(true)
        setCommentError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (
        commentIdentityRef.current === requestedIdentity &&
        commentLoadRevisionRef.current === loadRevision &&
        commentMutationRevisionRef.current === commentMutationRevision
      ) {
        setLoading(false)
      }
    }
  }, [config.token, draftRevisionId, canLoadComments, commentIdentity])
  const loadCommentsRef = useRef(loadComments)
  useLayoutEffect(() => {
    loadCommentsRef.current = loadComments
  }, [loadComments])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setCommentState({ identity: commentIdentityRef.current, items: [] })
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
      commentMutationPendingRef.current = false
      commentMutationRevisionRef.current += 1
      setMarkers(new Map())
      setBridgeReady(false)
      setSelectionMode(null)
      setPreparingSelection(false)
      setSelectedAnchor(null)
      setSelectionFailure(null)
      setCreateError("")
      setCommentError("")
      setRateLimitMessage("")
      setCommentsLoadFailed(false)
    }, 0)
    return () => window.clearTimeout(initial)
  }, [identity])

  useEffect(() => {
    if (!canLoadComments) return
    const initial = window.setTimeout(() => void loadComments(), 0)
    return () => window.clearTimeout(initial)
  }, [canLoadComments, loadComments])

  useEffect(() => {
    if (!canLoadComments) return
    const interval = window.setInterval(() => void loadComments(), 30_000)
    return () => window.clearInterval(interval)
  }, [canLoadComments, loadComments])

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
    async (mode: "element" | "area") => {
      if (!bridgeReady || !canCreateComment || selectionBlocked) return
      onActivate?.()
      const requestedIdentity = identity
      const selectionRequest = ++selectionRequestRef.current
      selectionRevisionRef.current = undefined
      setPreparingSelection(true)
      setCreateError("")
      setSelected(null)
      setSelectionFailure(null)
      setSelectionMode(mode)
      onClose()
      try {
        const next = await request<HubStatus>("/api/hub/status", config.token)
        if (
          identityRef.current !== requestedIdentity ||
          selectionRequestRef.current !== selectionRequest
        )
          return
        if (
          (!next.repositoryAuthorized && next.state !== "connected") ||
          next.prototype?.id !== prototypeId ||
          next.hubOrigin !== status?.hubOrigin ||
          next.repository !== status?.repository ||
          next.branch !== status?.branch ||
          !next.reviewRevision
        )
          throw new Error(next.reviewError || copy.commentPreparationFailed)
        selectionRevisionRef.current = next.reviewRevision
        sendBridge("replica:canvas:select", { mode })
      } catch (cause) {
        if (
          identityRef.current === requestedIdentity &&
          selectionRequestRef.current === selectionRequest
        ) {
          setSelectionMode(null)
          setCreateError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (selectionRequestRef.current === selectionRequest) setPreparingSelection(false)
      }
    },
    [
      onActivate,
      bridgeReady,
      canCreateComment,
      config.token,
      identity,
      onClose,
      prototypeId,
      selectionBlocked,
      sendBridge,
      status,
    ],
  )

  const cancelSelection = useCallback(() => {
    if (!selectionMode) return
    selectionRequestRef.current += 1
    selectionRevisionRef.current = undefined
    setPreparingSelection(false)
    sendBridge("replica:canvas:cancel-selection")
    setSelectionMode(null)
  }, [selectionMode, sendBridge])

  const clearSelection = useCallback(() => {
    selectionRequestRef.current += 1
    selectionRevisionRef.current = undefined
    sendBridge("replica:canvas:clear-selection")
    setSelectedAnchor(null)
    setSelectionFailure(null)
    setCreateError("")
  }, [sendBridge])

  const receiveSelection = useEffectEvent((data: Record<string, unknown>) => {
    if (!reviewActive || !selectionMode || preparingSelection) return
    if (data.type === "replica:canvas:selected") {
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
    } else if (
      data.type === "replica:canvas:selection-failed" &&
      (data.reason === "element-unavailable" ||
        data.reason === "area-too-small" ||
        data.reason === "area-unavailable")
    ) {
      setSelectionMode(null)
      setSelectionFailure(data.reason)
    } else if (data.type === "replica:canvas:selection-cancelled") {
      setSelectionMode(null)
    }
  })

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
      if (reviewActive && anchors.length)
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
        window.dispatchEvent(
          new CustomEvent("replica:review-dismiss", {
            detail: { restoreFocus: data.restoreFocus !== false },
          }),
        )
        return
      }
      if (data.type === "replica:canvas:resolved") {
        if (data.protocolVersion !== 1 || !reviewRoute(data.route)) return
        if (!Array.isArray(data.results)) return
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
      receiveSelection(data)
    }
    function onFrameLoad() {
      selectionRequestRef.current += 1
      setPreparingSelection(false)
      setSelectionMode(null)
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
    reviewActive,
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
    const requestedCommentIdentity = commentIdentity
    const updatesImmediately =
      action?.kind === "add-reaction" ||
      action?.kind === "remove-reaction" ||
      action?.kind === "mark-unread"
    if (action) {
      if (mutationRef.current) return false
      mutationRef.current = true
      setMutation(action)
    }
    if (updatesImmediately) {
      commentMutationPendingRef.current = true
      commentMutationRevisionRef.current += 1
    }
    setRateLimitMessage("")
    setCommentError("")
    try {
      const result = await request(`/api/hub/comments/${path}`, config.token, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (identityRef.current !== requestedIdentity) return false
      if (updatesImmediately) {
        const changed = REVIEW_COMMENT_MUTATION_SCHEMA.parse(result)
        setCommentState((previous) => {
          if (previous.identity !== requestedCommentIdentity) return previous
          const merged = new Map(previous.items.map((comment) => [comment.id, comment]))
          for (const comment of changed.comments) merged.set(comment.id, comment)
          return { identity: requestedCommentIdentity, items: [...merged.values()] }
        })
      }
      // Let the conversation clear its saved draft before updating the thread.
      if (!updatesImmediately)
        refreshTimer.current = window.setTimeout(() => void loadCommentsRef.current(), 0)
      return true
    } catch (cause) {
      if (identityRef.current === requestedIdentity) {
        setCommentError(cause instanceof Error ? cause.message : String(cause))
        if (cause instanceof Error && "statusCode" in cause && cause.statusCode === 429)
          setRateLimitMessage(cause.message)
      }
      return false
    } finally {
      if (action && identityRef.current === requestedIdentity) {
        if (updatesImmediately) {
          commentMutationPendingRef.current = false
          commentMutationRevisionRef.current += 1
          refreshTimer.current = window.setTimeout(() => void loadCommentsRef.current(), 0)
        }
        mutationRef.current = false
        setMutation(null)
      }
    }
  }

  async function createComment(body: string) {
    const selectedRevision = selectionRevisionRef.current
    if (!selectedRevision || !selectedAnchor || mutationRef.current) return false
    const requestedIdentity = identity
    const requestedCommentIdentity = commentIdentity
    mutationRef.current = true
    setMutation({ kind: "create" })
    setRateLimitMessage("")
    setCreateError("")
    setCommentError("")
    try {
      const result = REVIEW_COMMENT_MUTATION_SCHEMA.parse(
        await request("/api/hub/comments", config.token, {
          method: "POST",
          body: JSON.stringify({
            review_revision: selectedRevision,
            review_comment: {
              body,
              anchor: selectedAnchor,
            },
          }),
        }),
      )
      if (identityRef.current !== requestedIdentity) return false
      const root = result.comments.find((comment) => comment.kind === "root")
      if (!root) return false
      const visibleHere = root.buildNumber !== null || root.draftRevisionId === draftRevisionId
      if (visibleHere) {
        setCommentState((previous) => {
          if (previous.identity !== requestedCommentIdentity) return previous
          const merged = new Map(previous.items.map((comment) => [comment.id, comment]))
          for (const comment of result.comments) merged.set(comment.id, comment)
          return { identity: requestedCommentIdentity, items: [...merged.values()] }
        })
      }
      const openThread = visibleHere && commentIdentityRef.current === requestedCommentIdentity
      restoreReviewFocusRef.current = !openThread
      clearSelection()
      if (openThread) setSelected(root.id)
      void onStatusChange()
        .then(() => {
          if (identityRef.current === requestedIdentity) return loadCommentsRef.current()
        })
        .catch((cause: unknown) => {
          if (identityRef.current === requestedIdentity) {
            const message = cause instanceof Error ? cause.message : String(cause)
            setCommentError(copy.commentRefreshFailed(message))
          }
        })
      return true
    } catch (cause) {
      if (identityRef.current === requestedIdentity) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setCommentError(message)
        setCreateError(message)
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
    if (commentsOpen && reviewActive) {
      setSelected(null)
      setCommentsOpen(false)
      return
    }
    onActivate?.()
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
      {canLoadComments && reviewControlsTarget
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
                onStartAreaSelection={() => void startSelection("area")}
                onStartElementSelection={() => void startSelection("element")}
              />
              <Tooltip
                ref={commentsButtonRef}
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
                  aria-expanded={commentsOpen && reviewActive}
                  aria-keyshortcuts="Shift+C"
                  disabled={selectionBlocked}
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
      {reviewActive && showPins && visibleThreads.length && bridgeReady && !selectionMode ? (
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
      {canLoadComments ? (
        <ReviewCommentsSidebar
          frame={{
            open: commentsOpen && reviewActive,
            className: "canvas-comments-sidebar-shell",
            contentClassName: "canvas-comments-sidebar-content",
          }}
          threads={visibleThreads}
          currentBuildNumber={currentBuild?.number || 0}
          buildLinkOrigin={status?.hubOrigin}
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
        rateLimitNotice={
          !hubVisible ? rateLimitMessage || (!selectedAnchor && createError) || null : null
        }
        composer={
          selectedAnchor && selectedAnchorPoint
            ? {
                anchorPoint: selectedAnchorPoint,
                bodyMaximumBytes: 10_000,
                copy: reviewCommentsCopy,
                creating: mutation?.kind === "create",
                submitError: createError,
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
                onMarkUnread: () =>
                  change(`${active.root.id}/read`, "DELETE", undefined, {
                    kind: "mark-unread",
                    commentId: active.root.id,
                  }),
              }
            : null
        }
      />
    </MentionProvider>
  )
}
