import { reviewCommentsCopy } from "@utils/review-comment/en"

export const copy = {
  title: "Pick & polish",
  point: (id: number) => `Open improvement ${id}`,
  close: "Close improvements",
  open: "Open improvements",
  conversation: "Improvement",
  back: "Close improvement",
  copilot: "Copilot",
  markResolved: "Mark as resolved",
  retry: "Retry",
  returnToActive: "Return to active",
  followUps: (count: number) => `${count} ${count === 1 ? "follow-up" : "follow-ups"}`,
  actions: "Improvement actions",
  ready: "Ready to review",
  openStatus: "Open",
  changedIdentity:
    "The prototype branch or author changed. Close this dialog and reload before making changes.",
  targetUnavailable:
    "The saved target is not visible on this page. The conversation is shown beside the preview.",
  removed:
    "This improvement is no longer available. Close this dialog to return to the remaining improvements.",
  workStatus: (status: string) =>
    ({
      open: "Open",
      sent: "In progress",
      ready: "Ready to review",
      blocked: "Blocked",
      resolved: "Resolved",
    })[status] ?? status,
  filter: "Filter improvement notes",
  allActive: "Active notes",
  empty: "No improvements in this view.",
  resolved: "Resolved",
  resolve: "Resolved",
  fix: "Fix all",
  simulate: (count: number) => `Fix all, ${count} pending ${count === 1 ? "request" : "requests"}`,
  added: "Follow-up added.",
  delete: "Delete",
  deleteTitle: "Delete this note?",
  comments: {
    ...reviewCommentsCopy,
    replyLabel: "Follow-up",
    replyPlaceholder: "Request a follow-up change",
    replySubmitLabel: "Add follow-up",
    replySubmitTooltipMacLabel: "Add follow-up (⌘Enter)",
    replySubmitTooltipOtherLabel: "Add follow-up (Ctrl+Enter)",
    replyErrorLabel: "The follow-up could not be added.",
    threadDiscardPromptLabel: "Your unsaved follow-up will be lost.",
  },
}
