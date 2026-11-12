import { useCallback, useState } from "react"

import { mergeReviewComments } from "@utils/merge-review-comments"
import type { ReviewComment } from "@utils/review-comment/types"

import type { ReviewCommentsStateResult } from "./types"

interface ReviewCommentsStateValue {
  comments: ReviewComment[]
  hasLoadedComments: boolean
  loading: boolean
  loadFailed: boolean
}

function emptyReviewCommentsState(): ReviewCommentsStateValue {
  return {
    comments: [],
    hasLoadedComments: false,
    loading: true,
    loadFailed: false,
  }
}

/** Keeps the browser's local review-comment state internally consistent. */
export function useReviewCommentsState(): ReviewCommentsStateResult {
  const [state, setState] = useState(emptyReviewCommentsState)

  const resetComments = useCallback(() => {
    setState(emptyReviewCommentsState())
  }, [])

  const startRefreshingComments = useCallback(() => {
    setState((current) => ({
      ...current,
      loading: !current.hasLoadedComments,
      loadFailed: false,
    }))
  }, [])

  const replaceFullyLoadedComments = useCallback((comments: ReviewComment[]) => {
    setState({
      comments,
      hasLoadedComments: true,
      loading: false,
      loadFailed: false,
    })
  }, [])

  const mergeChangedComments = useCallback((comments: ReviewComment[]) => {
    setState((current) => ({
      ...current,
      comments: mergeReviewComments(comments, current.comments),
    }))
  }, [])

  const markCommentsLoadFailed = useCallback(() => {
    setState((current) => ({
      ...current,
      loading: false,
      loadFailed: true,
    }))
  }, [])

  const clearCommentsAfterAccessLoss = useCallback(() => {
    setState({
      comments: [],
      hasLoadedComments: false,
      loading: false,
      loadFailed: true,
    })
  }, [])

  return {
    comments: state.comments,
    loading: state.loading,
    loadFailed: state.loadFailed,
    clearCommentsAfterAccessLoss,
    markCommentsLoadFailed,
    mergeChangedComments,
    replaceFullyLoadedComments,
    resetComments,
    startRefreshingComments,
  }
}
