const hiddenMessages = new Set([
  "Notes are saved locally. Connect to Hub to sync.",
  "Notes are saved locally until Hub discovers this branch.",
  "Improvements are saved locally until their captured source has a published Build.",
  "This local improvement has no captured source. It cannot sync. Keep it locally or select its target again as a new improvement.",
  "These notes changed in another panel. Reload before making changes.",
  "This note changed while it was open. Reopen it before making changes.",
  "The open improvements changed while syncing. Review them and select Fix all again.",
])

export function canvasReviewError(message: string) {
  if (hiddenMessages.has(message)) return ""

  return message
    .replace(/^Local comments not synced: /, "Comments could not be synced: ")
    .replace(/\. Your notes remain saved locally\.$/, "")
    .replace(
      / You can still save this improvement locally, but it cannot sync without a captured source\.$/,
      "",
    )
}
