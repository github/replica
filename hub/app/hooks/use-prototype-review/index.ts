import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { useReviewComments } from "@hooks/use-review-comments"
import { getAreaAnchorGeometry } from "@utils/get-area-anchor-geometry"
import { groupReviewCommentsIntoThreads } from "@utils/group-review-comments-into-threads"
import type { ReviewThread } from "@utils/review-comment/types"
import { reviewThreadMatchesFilters } from "@utils/review-thread-matches-filters"

import { DEFAULT_REVIEW_COMMENT_FILTERS } from "./constants"
import type { PrototypeReviewOptions } from "./types"

export function usePrototypeReview({
  authenticityToken,
  iframeRef,
  previewTheme,
  reviewCommentsPath,
  viewerLogin,
  selectedBuild,
  transport,
  filters: controlledFilters,
  onFiltersChange,
  selectedThreadId: controlledThreadId,
  onSelectedThreadChange,
}: PrototypeReviewOptions) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [localFilters, setLocalFilters] = useState(DEFAULT_REVIEW_COMMENT_FILTERS)
  const filters = controlledFilters ?? localFilters
  const [showPins, setShowPins] = useState(true)
  const [localThreadId, setLocalThreadId] = useState<number | null>(null)
  const selectedThreadId = controlledThreadId === undefined ? localThreadId : controlledThreadId
  const setSelectedThreadId = useCallback(
    (id: number | null) => {
      setLocalThreadId(id)
      onSelectedThreadChange?.(id)
    },
    [onSelectedThreadChange],
  )
  function setFilters(nextFilters: typeof filters) {
    setLocalFilters(nextFilters)
    onFiltersChange?.(nextFilters)
  }
  const [conversationDraftActive, setConversationDraftActive] = useState(false)
  const focusLauncherOnClose = useRef(false)
  const toggleSidebar = useCallback(() => {
    if (conversationDraftActive) return

    if (sidebarOpen) {
      focusLauncherOnClose.current = true
      setSelectedThreadId(null)
    }
    setSidebarOpen(!sidebarOpen)
  }, [conversationDraftActive, sidebarOpen, setSelectedThreadId])
  useEffect(() => {
    if (sidebarOpen || !focusLauncherOnClose.current) return

    focusLauncherOnClose.current = false
    iframeRef.current
      ?.closest(".review-layout")
      ?.querySelector<HTMLButtonElement>(".review-shell__comments-toggle")
      ?.focus({ preventScroll: true })
  }, [iframeRef, sidebarOpen])
  const comments = useReviewComments(reviewCommentsPath, authenticityToken, transport)
  const threads = useMemo(
    () => groupReviewCommentsIntoThreads(comments.comments),
    [comments.comments],
  )
  const participants = useMemo(() => {
    const participantsByLogin = new Map(
      threads.flatMap((thread) =>
        thread.participants.map((participant) => [participant.login.toLowerCase(), participant]),
      ),
    )
    return Array.from(participantsByLogin.values()).sort((first, second) =>
      (first.name || first.login).localeCompare(second.name || second.login),
    )
  }, [threads])
  const handleSelectionStart = useCallback(() => {
    setSelectedThreadId(null)
    setConversationDraftActive(false)
  }, [setSelectedThreadId])
  const anchorReferences = useMemo(
    () =>
      threads.map((thread) => ({
        commentId: thread.root.id,
        originBuild: thread.root.buildNumber === selectedBuild?.number,
        anchor: thread.root.anchor,
      })),
    [selectedBuild?.number, threads],
  )
  const bridge = usePreviewBridge({
    iframeRef,
    previewUrl: selectedBuild?.previewUrl,
    previewTheme,
    anchors: anchorReferences,
    onSelectionStart: handleSelectionStart,
    onToggleSidebar: toggleSidebar,
    selectionBlocked: conversationDraftActive,
  })
  const visibleThreads = useMemo(
    () =>
      threads.filter((thread) =>
        reviewThreadMatchesFilters(thread, {
          filters,
          viewerLogin,
          selectedBuildNumber: selectedBuild?.number,
          route: bridge.route,
        }),
      ),
    [bridge.route, filters, selectedBuild?.number, threads, viewerLogin],
  )
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.root.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  )
  const selectedResolution = selectedThread
    ? bridge.resolutions.get(selectedThread.root.id)
    : undefined
  const selectedThreadPoint =
    selectedThread &&
    selectedResolution &&
    (selectedResolution.status === "resolved" || selectedResolution.status === "moved")
      ? selectedThread.root.anchor.kind === "area"
        ? getAreaAnchorGeometry(selectedThread.root.anchor, selectedResolution.rect).point
        : selectedResolution.point
      : null
  const selectedAnchorPoint = bridge.selectedAnchor
    ? bridge.selectedAnchor.kind === "element"
      ? {
          x:
            bridge.selectedAnchor.rect.x -
            bridge.selectedAnchor.viewport.scrollX +
            bridge.selectedAnchor.rect.width * bridge.selectedAnchor.elementOffset.x,
          y:
            bridge.selectedAnchor.rect.y -
            bridge.selectedAnchor.viewport.scrollY +
            bridge.selectedAnchor.rect.height * bridge.selectedAnchor.elementOffset.y,
        }
      : getAreaAnchorGeometry(bridge.selectedAnchor, {
          x: bridge.selectedAnchor.rect.x - bridge.selectedAnchor.viewport.scrollX,
          y: bridge.selectedAnchor.rect.y - bridge.selectedAnchor.viewport.scrollY,
          width: bridge.selectedAnchor.rect.width,
          height: bridge.selectedAnchor.rect.height,
        }).point
    : null

  function startElementSelection() {
    bridge.startElementSelection()
  }

  function startAreaSelection() {
    bridge.startAreaSelection()
  }

  function selectThread(thread: ReviewThread) {
    if (conversationDraftActive && selectedThreadId !== thread.root.id) return

    setSelectedThreadId(thread.root.id)
    const status = bridge.resolutions.get(thread.root.id)?.status
    if (status === "resolved" || status === "moved") {
      bridge.focusAnchor(thread.root.id)
    }
  }

  async function createComment(body: string) {
    if (!selectedBuild || !bridge.selectedAnchor) return false

    const saved = await comments.createComment(selectedBuild.number, body, bridge.selectedAnchor)
    if (!saved || saved.kind !== "root") return false

    bridge.clearSelection()
    setSelectedThreadId(saved.id)
    return true
  }

  function closeThread() {
    setSelectedThreadId(null)
    setConversationDraftActive(false)
  }

  return {
    bridge,
    closeThread,
    comments,
    conversationDraftActive,
    createComment,
    filters,
    participants,
    selectedAnchorPoint,
    selectedThread,
    selectedThreadId: selectedThread?.root.id ?? null,
    selectedThreadPoint,
    selectThread,
    setConversationDraftActive,
    setFilters,
    setShowPins,
    setSidebarOpen,
    toggleSidebar,
    showPins,
    sidebarOpen,
    startAreaSelection,
    startElementSelection,
    threads,
    visibleThreads,
  }
}
