import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePrototypeReview } from "@hooks/use-prototype-review"
import { useReviewLiveUpdates } from "@hooks/use-review-live-updates"
import { MentionProvider } from "@components/mention-provider"
import { PrototypesShowPage } from "@pages/prototypes-show-page"
import type { PrototypeDetailsInput } from "@pages/prototypes-show-page/types"
import type { PrototypeResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import type { AppliedLearningResponse } from "@application/hub/learnings-contracts/types"
import { prototypeShowData } from "@application/hub/view-models/prototype-show-data"
import { createReviewTransport } from "@application/hub/create-review-transport"
import { readReviewQuery } from "@application/hub/read-review-query"
import { authorizeCopilotHandoff } from "@application/hub/requests/authorize-copilot-handoff"
import { requestJson } from "@application/hub/requests/request-json"
import { acknowledgeInboxActivity } from "@application/hub/requests/acknowledge-inbox-activity"
import { MENTION_CANDIDATES_SCHEMA } from "@utils/mention-candidate/schemas"
import { getUrlOrigin } from "@utils/get-url-origin"
import { privateReviewLink } from "@utils/private-review-link"
import { previewLogicalPathname } from "@utils/preview-logical-pathname"
import { readPreviewReturnPath } from "@utils/read-preview-return-path"

export function PrototypeScreen({
  workspace,
  data,
  appliedLearnings,
  onSaveDetails,
  savingDetails,
  detailsError,
  detailsSaved,
}: {
  workspace: WorkspaceResponse
  data: PrototypeResponse
  appliedLearnings?: AppliedLearningResponse[]
  onSaveDetails: (details: PrototypeDetailsInput) => void
  savingDetails: boolean
  detailsError: string | null
  detailsSaved: boolean
}) {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => readReviewQuery(params), [params])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const repositoryCapabilities = workspace.repositories.find(
    ({ id }) => id === data.repository.id,
  )?.capabilities
  const pageData = prototypeShowData(
    workspace,
    data,
    new URLSearchParams(location.search),
    appliedLearnings,
  )
  pageData.reviewReadOnly = !repositoryCapabilities?.reviewPrototypes
  if (pageData.reviewReadOnly) {
    pageData.reviewComments = {
      ...pageData.reviewComments,
      copy: {
        ...pageData.reviewComments.copy,
        selectionBlockedLabel: "You do not have permission to add review comments.",
      },
    }
  }
  const routeUrl = `${window.location.origin}${location.pathname}`
  const preview = pageData.selectedBuild && new URL(pageData.selectedBuild.previewUrl)
  const isolated = Boolean(preview && getUrlOrigin(preview.href) !== preview.origin)
  const requestedRoutes = params.getAll("return_path")
  const requestedRoute =
    requestedRoutes.length === 1 ? readPreviewReturnPath(requestedRoutes[0]) : null
  const logicalRequest = params.get("return_path_kind") === "logical"
  if (isolated && requestedRoute && preview && pageData.selectedBuild) {
    preview.searchParams.set("route", requestedRoute)
    if (logicalRequest) preview.searchParams.set("route_kind", "logical")
    pageData.selectedBuild.previewUrl = preview.href
  }
  const transport = useMemo(() => createReviewTransport(routeUrl), [routeUrl])
  const mentionSource = useMemo(
    () => ({
      load: async (query: string, signal: AbortSignal) => {
        const url = new URL(`${pageData.reviewCommentsPath}/mention-candidates`, routeUrl)
        url.searchParams.set("q", query)
        const { candidates } = await requestJson(url, MENTION_CANDIDATES_SCHEMA, { signal })
        return candidates
      },
      copy: {
        suggestions: "Mention a collaborator",
        error: "Collaborators could not be loaded.",
        loading: "Loading collaborators…",
        empty: "No matching collaborators",
        retry: "Retry",
        limit: "Mention up to 10 people in each message.",
      },
    }),
    [pageData.reviewCommentsPath, routeUrl],
  )
  const selectThread = useCallback(
    (id: number | null) => {
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (next.get("comment") !== String(id)) {
          next.delete("notification")
          next.delete("message")
        }
        if (id === null) next.delete("comment")
        else next.set("comment", String(id))
        return next
      })
    },
    [setParams],
  )
  const review = usePrototypeReview({
    authenticityToken: "",
    iframeRef,
    previewTheme: resolvedColorMode,
    repositoryId: data.repository.id,
    prototypeId: data.prototype.id,
    reviewCommentsPath: pageData.reviewCommentsPath,
    viewerLogin: workspace.viewer.login,
    selectedBuild: pageData.selectedBuild,
    reviewReadOnly: pageData.reviewReadOnly,
    transport,
    filters: query.filters,
    selectedThreadId: query.commentId,
    onSelectedThreadChange: selectThread,
    onFiltersChange: (filters) => {
      const next = new URLSearchParams(params)
      if (filters.search) next.set("commentSearch", filters.search)
      else next.delete("commentSearch")
      if (filters.participant) next.set("commentParticipant", filters.participant)
      else next.delete("commentParticipant")
      for (const [name, enabled] of [
        ["commentBuild", filters.currentBuildOnly],
        ["commentPage", filters.currentPageOnly],
        ["commentResolved", filters.showResolved],
        ["commentUnread", !filters.showRead],
        ["commentMine", filters.onlyMine],
      ] as const) {
        if (enabled) next.set(name, "1")
        else next.delete(name)
      }
      setParams(next)
    },
  })
  const { notificationId, messageId, commentId } = query
  const thread = review.selectedThread
  const route = thread?.root.anchor.route ?? review.bridge.route
  // A thread from a different Build keeps its original address.
  const mount =
    !thread || thread.root.buildNumber === data.selectedBuild?.number
      ? review.bridge.previewMount
      : undefined
  const reviewLink = pageData.privatePreviewUrl
    ? privateReviewLink({
        baseUrl: routeUrl,
        buildNumber:
          thread?.root.buildNumber ??
          (pageData.buildPinned ? data.selectedBuild?.number : undefined),
        route: route
          ? `${previewLogicalPathname(route.pathname, mount)}${route.search}${route.hash}`
          : (requestedRoute ?? pageData.startPage ?? undefined),
        logicalRoute: route ? mount !== undefined : Boolean(requestedRoute && logicalRequest),
        threadId: thread?.root.id,
      })
    : undefined
  const channel =
    !pageData.reviewReadOnly &&
    /^[\da-f-]{36}$/i.test(data.repository.id) &&
    /^[\da-f-]{36}$/i.test(data.prototype.id)
      ? `review:${data.repository.id}:${data.prototype.id}`
      : null
  useReviewLiveUpdates(channel, review.comments.refreshComments)

  const [opened, setOpened] = useState<{ notificationId: number; messageId: number } | null>(null)
  const [failedNotification, setFailedNotification] = useState<number | null>(null)
  const messageOpened = useCallback(
    (commentId: number) => {
      if (notificationId !== null) setOpened({ notificationId, messageId: commentId })
    },
    [notificationId],
  )

  const targetExists = review.comments.comments.some(
    (message) =>
      message.id === messageId &&
      !message.deletedAt &&
      (message.kind === "root" ? message.id : message.rootId) === commentId,
  )
  const viewerId = workspace.viewer.id
  useEffect(() => {
    if (
      !notificationId ||
      !commentId ||
      !messageId ||
      !targetExists ||
      opened?.notificationId !== notificationId ||
      opened.messageId !== messageId
    )
      return
    const controller = new AbortController()
    void acknowledgeInboxActivity(
      {
        viewerId,
        notificationId,
        prototypeId: data.prototype.id,
        threadId: commentId,
        commentId: messageId,
      },
      controller.signal,
    ).catch(() => {
      if (!controller.signal.aborted) setFailedNotification(notificationId)
    })
    return () => controller.abort()
  }, [notificationId, commentId, messageId, targetExists, opened, data.prototype.id, viewerId])
  let notificationError: string | undefined
  if (notificationId !== null) {
    if (!review.comments.loading && !targetExists) {
      notificationError = "This review message is no longer available."
    } else if (notificationId === failedNotification) {
      notificationError = "The Inbox activity could not be marked as read."
    }
  }

  return (
    <MentionProvider source={mentionSource}>
      <PrototypesShowPage
        key={`${data.repository.id}:${data.prototype.id}`}
        data={{
          ...pageData,
          privateReviewLink: reviewLink,
          initialNotificationId: notificationId ?? undefined,
          initialCommentId: messageId ?? undefined,
          notificationErrorLabel: notificationError,
        }}
        iframeRef={iframeRef}
        previewTheme={resolvedColorMode}
        monitorPreview={isolated}
        review={review}
        onNotificationMessageOpened={messageOpened}
        initialMinimized={pageData.minimizedPreview}
        onSaveDetails={data.prototype.canEdit ? onSaveDetails : undefined}
        savingDetails={savingDetails}
        detailsError={detailsError}
        detailsSaved={detailsSaved}
        authorizeHandoff={() => authorizeCopilotHandoff(data.repository.id)}
      />
    </MentionProvider>
  )
}
