import type { z } from "zod"

import type { REVIEW_COMMENT_SCHEMA } from "./schemas"

export type ReviewComment = z.infer<typeof REVIEW_COMMENT_SCHEMA>
export type ReviewRootComment = Extract<ReviewComment, { kind: "root" }>
export type ReviewReply = Extract<ReviewComment, { kind: "reply" }>
export type ReviewCommentAuthor = ReviewComment["author"]
export type ReviewReaction = ReviewComment["reactions"][number]
export type ReviewReactionContent = ReviewReaction["content"]

export interface ReviewThread {
  root: ReviewRootComment
  replies: ReviewReply[]
  participants: ReviewCommentAuthor[]
  lastActivityAt: string
  unread: boolean
}

export interface ReviewCommentFilters {
  search: string
  currentBuildOnly: boolean
  currentPageOnly: boolean
  showResolved: boolean
  showRead: boolean
  onlyMine: boolean
  participant: string | null
}

export interface ReviewCommentsCopy {
  heading: string
  closeLabel: string
  commentMenuLabel: string
  commentOnElementLabel: string
  highlightRegionLabel: string
  cancelSelectionLabel: string
  bridgeUnavailableLabel: string
  selectionBlockedLabel: string
  selectionFailedLabel: string
  areaTooSmallLabel: string
  areaUnavailableLabel: string
  searchLabel: string
  searchPlaceholder: string
  filterLabel: string
  currentBuildFilterLabel: string
  currentPageFilterLabel: string
  participantFilterLabel: string
  allParticipantsLabel: string
  showResolvedLabel: string
  unreadOnlyLabel: string
  onlyMineLabel: string
  showPinsLabel: string
  sidebarShortcutLabel: string
  loadingLabel: string
  loadErrorLabel: string
  retryLabel: string
  emptyLabel: string
  noMatchesLabel: string
  buildLabel: string
  movedAnchorLabel: string
  changedAnchorLabel: string
  missingAnchorLabel: string
  routeMismatchLabel: string
  resolvedLabel: string
  markerLabel: string
  markerWithRepliesLabel: string
  unreadLabel: string
  unreadMarkerLabel: string
  unreadMarkerWithRepliesLabel: string
  replyCountOneLabel: string
  replyCountOtherLabel: string
  threadHeading: string
  backToCommentsLabel: string
  resolvedByLabel: string
  editedLabel: string
  deletedCommentLabel: string
  addReactionLabel: string
  reactionCountOneLabel: string
  reactionCountOtherLabel: string
  reactionErrorLabel: string
  readErrorLabel: string
  markUnreadLabel: string
  markUnreadErrorLabel: string
  reactionLabels: Record<ReviewReactionContent, string>
  commentActionsLabel: string
  editLabel: string
  deleteLabel: string
  editCommentLabel: string
  saveEditLabel: string
  savingEditLabel: string
  cancelEditLabel: string
  editErrorLabel: string
  deleteHeading: string
  deletePromptLabel: string
  confirmDeleteLabel: string
  deletingLabel: string
  deleteErrorLabel: string
  replyLabel: string
  replyPlaceholder: string
  replySubmitLabel: string
  replySubmitTooltipMacLabel: string
  replySubmitTooltipOtherLabel: string
  replyingLabel: string
  replyErrorLabel: string
  resolveLabel: string
  resolvingLabel: string
  reopenLabel: string
  reopeningLabel: string
  resolutionErrorLabel: string
  resolvedReplyBlockedLabel: string
  deletedReplyBlockedLabel: string
  threadDiscardPromptLabel: string
  composerHeading: string
  composerLabel: string
  composerPlaceholder: string
  submitLabel: string
  submitTooltipMacLabel: string
  submitTooltipOtherLabel: string
  submittingLabel: string
  closeComposerLabel: string
  discardHeading: string
  discardPromptLabel: string
  keepLabel: string
  discardButtonLabel: string
  bodyTooLongLabel: string
  createErrorLabel: string
}
