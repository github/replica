import { useEffect, useState } from "react"

import type { ReviewComment } from "@utils/review-comment/types"

import type {
  ReviewThreadConversationActions,
  ReviewThreadConversationState,
  UseReviewThreadConversationOptions,
} from "./types"

const TEXT_ENCODER = new TextEncoder()

/** Keeps reply and edit drafts coordinated so navigation cannot discard review text. */
export function useReviewThreadConversation({
  thread,
  bodyMaximumBytes,
  mutation,
  onClose,
  onDraftStateChange,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
}: UseReviewThreadConversationOptions): {
  state: ReviewThreadConversationState
  actions: ReviewThreadConversationActions
} {
  const [replyDraft, setReplyDraft] = useState("")
  const [replyFailed, setReplyFailed] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [editingOriginalBody, setEditingOriginalBody] = useState("")
  const [editFailed, setEditFailed] = useState(false)
  const [confirmingEditDiscard, setConfirmingEditDiscard] = useState(false)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [resolutionFailed, setResolutionFailed] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const draftActive = replyDraft.trim() !== "" || editingCommentId !== null
  const replyBodyTooLong = TEXT_ENCODER.encode(replyDraft).length > bodyMaximumBytes
  const editBodyTooLong = TEXT_ENCODER.encode(editDraft).length > bodyMaximumBytes
  const resolved = thread.root.resolvedAt !== null
  const replyBlocked = thread.root.deletedAt !== null || resolved

  useEffect(() => {
    onDraftStateChange(draftActive)
    return () => onDraftStateChange(false)
  }, [draftActive, onDraftStateChange])

  function requestDismissal() {
    if (mutation) return

    if (replyDraft.trim() === "" && editDraft === editingOriginalBody) {
      onClose()
      return
    }

    setConfirmingEditDiscard(false)
    setConfirmingDiscard(true)
  }

  function discardAndClose() {
    setReplyDraft("")
    setEditingCommentId(null)
    setEditDraft("")
    setEditingOriginalBody("")
    setConfirmingEditDiscard(false)
    setConfirmingDiscard(false)
    onDraftStateChange(false)
    onClose()
  }

  async function submitReply() {
    if (replyDraft.trim() === "" || replyBodyTooLong || mutation) return

    const saved = await onReply(replyDraft)
    if (!saved) {
      setReplyFailed(true)
      return
    }

    setReplyDraft("")
    setReplyFailed(false)
  }

  function changeReplyDraft(draft: string) {
    setReplyDraft(draft)
    setReplyFailed(false)
    setConfirmingDiscard(false)
  }

  function startEdit(comment: ReviewComment) {
    if (!comment.body) return

    setEditingCommentId(comment.id)
    setEditDraft(comment.body)
    setEditingOriginalBody(comment.body)
    setEditFailed(false)
    setConfirmingDeleteId(null)
    setDeleteFailed(false)
  }

  function changeEditDraft(draft: string) {
    setEditDraft(draft)
    setEditFailed(false)
    setConfirmingEditDiscard(false)
    setConfirmingDiscard(false)
  }

  async function saveEdit(commentId: number) {
    if (editDraft.trim() === "" || editBodyTooLong || mutation) return

    const saved = await onEdit(commentId, editDraft)
    if (!saved) {
      setEditFailed(true)
      return
    }

    setEditingCommentId(null)
    setEditDraft("")
    setEditingOriginalBody("")
    setConfirmingEditDiscard(false)
    setEditFailed(false)
  }

  function cancelEdit() {
    if (editDraft !== editingOriginalBody) {
      setConfirmingEditDiscard(true)
      return
    }

    discardEdit()
  }

  function discardEdit() {
    setEditingCommentId(null)
    setEditDraft("")
    setEditingOriginalBody("")
    setEditFailed(false)
    setConfirmingEditDiscard(false)
    setConfirmingDiscard(false)
  }

  function requestDelete(commentId: number) {
    setConfirmingDeleteId(commentId)
    setDeleteFailed(false)
  }

  function cancelDelete() {
    setConfirmingDeleteId(null)
    setDeleteFailed(false)
  }

  async function deleteComment(commentId: number) {
    if (mutation) return

    const deleted = await onDelete(commentId)
    if (!deleted) {
      setDeleteFailed(true)
      return
    }

    cancelDelete()
  }

  async function changeResolution() {
    if (mutation || draftActive) return

    const changed = resolved ? await onReopen() : await onResolve()
    setResolutionFailed(!changed)
  }

  return {
    state: {
      replyDraft,
      replyFailed,
      editingCommentId,
      editDraft,
      editFailed,
      confirmingEditDiscard,
      confirmingDeleteId,
      deleteFailed,
      resolutionFailed,
      confirmingDiscard,
      draftActive,
      replyBodyTooLong,
      editBodyTooLong,
      resolved,
      replyBlocked,
    },
    actions: {
      requestDismissal,
      discardAndClose,
      keepDraft: () => setConfirmingDiscard(false),
      submitReply,
      changeReplyDraft,
      startEdit,
      changeEditDraft,
      saveEdit,
      cancelEdit,
      keepEdit: () => setConfirmingEditDiscard(false),
      discardEdit,
      requestDelete,
      cancelDelete,
      deleteComment,
      changeResolution,
    },
  }
}
