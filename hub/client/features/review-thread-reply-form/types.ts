import type { ReviewCommentsCopy } from "@utils/review-comment/types"

export interface ReviewThreadReplyFormProps {
  blockedLabel: string | null
  confirmingDiscard: boolean
  replyDraft: string
  replyBodyTooLong: boolean
  replyFailed: boolean
  replyDisabled: boolean
  replying: boolean
  submitDisabled?: boolean
  copy: ReviewCommentsCopy
  onKeepDraft: () => void
  onDiscardDraft: () => void
  onSubmit: () => void
  onDraftChange: (draft: string) => void
}
