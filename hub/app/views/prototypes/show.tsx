import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"

import { MentionProvider } from "@components/mention-provider"
import { HubAlert } from "@components/hub-alert"
import { useHubTheme } from "@hooks/use-hub-theme"
import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { usePrototypeReview } from "@hooks/use-prototype-review"
import { usePrototypeViewerUrl } from "@hooks/use-prototype-viewer-url"
import { PrototypesShowPage } from "@pages/prototypes-show-page"
import { MENTION_CANDIDATES_SCHEMA } from "@utils/mention-candidate/schemas"
import { NOTIFICATION_READ_SCHEMA } from "@utils/notification/schemas"

import type { PrototypesShowViewData } from "./types"

export default function PrototypesShowView() {
  const data = useRepositoryInbox(usePageData<PrototypesShowViewData>())
  useEffect(() => {
    document.title = data.prototypeName
    return () => {
      document.title = data.defaultDocumentTitle
    }
  }, [data.prototypeName, data.defaultDocumentTitle])

  const [notificationFailed, setNotificationFailed] = useState(false)
  const openedMessage = useRef<number | null>(null)
  const acknowledged = useRef<number | null>(null)
  const focusedMessage = useRef<number | null>(null)
  const inboxReadUpdate = useRef(data.liveInbox?.onReadUpdate)
  useEffect(() => {
    inboxReadUpdate.current = data.liveInbox?.onReadUpdate
  }, [data.liveInbox?.onReadUpdate])
  const loadMentions = useCallback(async () => {
    if (!data.mentionCandidatesPath) throw new Error("Mention suggestions are unavailable")

    const response = await fetch(data.mentionCandidatesPath, { credentials: "same-origin" })
    if (!response.ok) throw new Error("Mention suggestions are unavailable")

    return MENTION_CANDIDATES_SCHEMA.parse(await response.json()).candidates
  }, [data.mentionCandidatesPath])
  const mentionSource = useMemo(
    () => (data.mentionCopy ? { load: loadMentions, copy: data.mentionCopy } : null),
    [data.mentionCopy, loadMentions],
  )
  const { resolvedColorMode: previewTheme } = useHubTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const review = usePrototypeReview({
    authenticityToken: data.authenticityToken,
    iframeRef,
    prototypeId: data.prototypeId,
    repositoryId: data.repositoryId,
    reviewCommentsPath: data.reviewCommentsPath,
    viewerLogin: data.currentUser.login,
    selectedBuild: data.selectedBuild,
    previewTheme,
  })
  const viewer = usePrototypeViewerUrl({
    selectedBuild: data.selectedBuild,
    route: review.bridge.route,
    initiallyMinimized: data.minimizedPreview,
  })
  useEffect(() => {
    if (!data.initialCommentId || openedMessage.current === data.initialCommentId) return

    const thread = review.threads.find((thread) =>
      [thread.root, ...thread.replies].some((message) => message.id === data.initialCommentId),
    )
    if (!thread) {
      if (!review.comments.loading && !review.comments.loadFailed) {
        const timer = window.setTimeout(() => setNotificationFailed(true), 0)
        return () => window.clearTimeout(timer)
      }
      return
    }

    openedMessage.current = data.initialCommentId
    review.selectThread(thread)
  }, [data.initialCommentId, review])

  useEffect(() => {
    if (!data.initialCommentId || !review.selectedThread) return

    const element = document.querySelector<HTMLElement>(
      `[data-review-message-id="${data.initialCommentId}"]`,
    )
    if (!element) return

    element.dataset.notificationTarget = "true"
    if (focusedMessage.current !== data.initialCommentId) {
      focusedMessage.current = data.initialCommentId
      element.tabIndex = -1
      element.scrollIntoView?.({ block: "nearest" })
      element.focus({ preventScroll: true })
    }
    const notificationId = data.initialNotificationId
    if (!notificationId || acknowledged.current === notificationId) return

    acknowledged.current = notificationId
    const notificationPath = `/notifications/${notificationId}`
    void (async () => {
      const response = await fetch(notificationPath, { credentials: "same-origin" })
      if (!response.ok) throw new Error("Notification is unavailable")

      const notification = z
        .object({
          commentId: z.number().int().positive(),
          version: z.number().int().nonnegative(),
        })
        .parse(await response.json())
      if (notification.commentId !== data.initialCommentId)
        throw new Error("Notification target changed")

      const saved = await fetch(notificationPath, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": data.authenticityToken },
        body: JSON.stringify({ notification: { read: true, version: notification.version } }),
      })
      if (!saved.ok) throw new Error("Notification could not be marked read")

      const update = NOTIFICATION_READ_SCHEMA.parse(await saved.json())
      if (!update.read) throw new Error("Notification was not marked read")

      inboxReadUpdate.current?.(notificationId, update)
    })().catch(() => setNotificationFailed(true))
  }, [
    data.authenticityToken,
    data.initialCommentId,
    data.initialNotificationId,
    review.selectedThread,
  ])

  const page = (
    <>
      {notificationFailed ? (
        <HubAlert
          variant="critical"
          title={data.notificationErrorLabel || data.reviewComments.copy.readErrorLabel}
        />
      ) : null}
      <PrototypesShowPage
        key={data.prototypeId}
        data={data}
        iframeRef={iframeRef}
        previewTheme={previewTheme}
        review={review}
        viewerUrl={viewer.viewerUrl}
        minimized={viewer.minimized}
        initialInfoOpen={data.initialCommentId ? false : undefined}
        onMinimizedChange={viewer.setMinimized}
      />
    </>
  )
  return mentionSource ? <MentionProvider source={mentionSource}>{page}</MentionProvider> : page
}
