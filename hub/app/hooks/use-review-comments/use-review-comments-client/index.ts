import { useCallback, useEffect, useRef } from "react"

import { REVIEW_COMMENT_MUTATION_SCHEMA } from "@utils/review-comment/schemas"
import { readRateLimitError } from "@utils/read-rate-limit-error"
import type { ReviewComment } from "@utils/review-comment/types"

import { fetchAllReviewComments } from "./fetch-all-review-comments"
import { reviewAccessUnavailable } from "./review-access-unavailable"
import type {
  ReviewCommentChangeMethod,
  ReviewCommentsClient,
  ReviewCommentsClientOptions,
} from "./types"

interface ActiveReviewCommentsClient extends ReviewCommentsClient {
  dispose: () => void
}

/** Creates one disposable client that keeps comment requests in a safe order. */
function createReviewCommentsClient({
  authenticityToken,
  path,
  onCommentsChanged,
  onCommentsLoadFailed,
  onCommentsLoaded,
  onRefreshStarted,
  onReviewAccessLost,
  onMutationRateLimited,
  transport,
}: Omit<ReviewCommentsClientOptions, "onReset">): ActiveReviewCommentsClient {
  let activeChanges = 0
  let activeRefreshController: AbortController | null = null
  let disposed = false
  let refreshRequested = false
  let writeRevision = 0
  const pendingChanges = new Set<AbortController>()

  function startRefreshIfReady() {
    if (disposed || activeChanges > 0 || activeRefreshController || !refreshRequested) return

    refreshRequested = false
    onRefreshStarted()
    const controller = new AbortController()
    activeRefreshController = controller

    void (async () => {
      try {
        const result = await (transport?.load ?? fetchAllReviewComments)(path, controller.signal)
        if (disposed || controller.signal.aborted) return

        if (result.kind === "success") {
          onCommentsLoaded(result.comments)
          return
        }
        if (refreshRequested) return

        if (result.kind === "access-lost") {
          onReviewAccessLost()
        } else {
          onCommentsLoadFailed()
        }
      } catch {
        if (!disposed && !controller.signal.aborted && !refreshRequested) {
          onCommentsLoadFailed()
        }
      } finally {
        if (activeRefreshController === controller) {
          activeRefreshController = null
          startRefreshIfReady()
        }
      }
    })()
  }

  function refreshComments() {
    if (disposed) return

    refreshRequested = true
    startRefreshIfReady()
  }

  async function sendCommentChange(
    requestPath: string,
    method: ReviewCommentChangeMethod,
    body?: object,
  ) {
    if (disposed) return null

    const markingRead = method === "POST" && requestPath.endsWith("/read")
    if (!markingRead) writeRevision += 1
    const requestedWriteRevision = writeRevision
    activeChanges += 1
    if (activeRefreshController) {
      refreshRequested = true
      activeRefreshController.abort()
    }

    try {
      let changedComments: ReviewComment[]
      if (transport) {
        const controller = new AbortController()
        pendingChanges.add(controller)
        try {
          changedComments = await transport.change(requestPath, method, body, controller.signal)
        } catch (error) {
          if (!disposed) {
            onMutationRateLimited?.(
              error instanceof Error ? error.message : "The review change could not be saved.",
            )
          }
          return null
        } finally {
          pendingChanges.delete(controller)
        }
      } else {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "X-CSRF-Token": authenticityToken,
        }
        if (body) headers["Content-Type"] = "application/json"

        let response: Response
        try {
          response = await fetch(requestPath, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
          })
        } catch {
          return null
        }

        if (reviewAccessUnavailable(response)) refreshComments()
        if (response.status === 429) {
          const message = await readRateLimitError(response)
          if (message && !disposed) onMutationRateLimited?.(message)
          return null
        }
        if (!response.ok || response.redirected) return null

        let responseBody: unknown
        try {
          responseBody = await response.json()
        } catch {
          return null
        }
        const parsedMutation = REVIEW_COMMENT_MUTATION_SCHEMA.safeParse(responseBody)
        if (!parsedMutation.success || disposed) return null
        changedComments = parsedMutation.data.comments
      }

      if (disposed) return null

      if (markingRead && (requestedWriteRevision !== writeRevision || activeChanges > 1)) {
        refreshComments()
      } else {
        onCommentsChanged(changedComments)
      }
      return changedComments[0] ?? null
    } finally {
      if (!markingRead) writeRevision += 1
      activeChanges -= 1
      startRefreshIfReady()
    }
  }

  function dispose() {
    disposed = true
    refreshRequested = false
    activeRefreshController?.abort()
    activeRefreshController = null
    pendingChanges.forEach((controller) => controller.abort())
    pendingChanges.clear()
  }

  return { dispose, refreshComments, sendCommentChange }
}

/** Calls the authorized review-comment API and refreshes its canonical data. */
export function useReviewCommentsClient({
  authenticityToken,
  path,
  onCommentsChanged,
  onCommentsLoadFailed,
  onCommentsLoaded,
  onRefreshStarted,
  onReset,
  onReviewAccessLost,
  onMutationRateLimited,
  transport,
}: ReviewCommentsClientOptions): ReviewCommentsClient {
  const clientRef = useRef<ActiveReviewCommentsClient | null>(null)

  useEffect(() => {
    const client = createReviewCommentsClient({
      authenticityToken,
      path,
      onCommentsChanged,
      onCommentsLoadFailed,
      onCommentsLoaded,
      onRefreshStarted,
      onReviewAccessLost,
      onMutationRateLimited,
      transport,
    })
    clientRef.current = client
    onReset()
    client.refreshComments()

    return () => {
      if (clientRef.current === client) clientRef.current = null
      client.dispose()
    }
  }, [
    authenticityToken,
    onCommentsChanged,
    onCommentsLoadFailed,
    onCommentsLoaded,
    onRefreshStarted,
    onReset,
    onReviewAccessLost,
    onMutationRateLimited,
    path,
    transport,
  ])

  const refreshComments = useCallback(() => {
    clientRef.current?.refreshComments()
  }, [])

  const sendCommentChange = useCallback(
    async (requestPath: string, method: ReviewCommentChangeMethod, body?: object) => {
      const client = clientRef.current
      return client ? client.sendCommentChange(requestPath, method, body) : null
    },
    [],
  )

  return { refreshComments, sendCommentChange }
}
