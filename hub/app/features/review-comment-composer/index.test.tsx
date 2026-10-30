import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReviewCommentsCopy } from "@utils/review-comment/types"

import { ReviewCommentComposer } from "."

const COPY: ReviewCommentsCopy = {
  heading: "Comments",
  closeLabel: "Close comments",
  commentMenuLabel: "Add a comment",
  commentOnElementLabel: "Comment on element",
  highlightRegionLabel: "Highlight a region",
  cancelSelectionLabel: "Cancel selection",
  bridgeUnavailableLabel: "Adding comments needs the review bridge.",
  selectionBlockedLabel: "Close or submit the open draft.",
  selectionFailedLabel: "Hub could not anchor a comment to that element.",
  areaTooSmallLabel: "Draw a larger region to add a comment.",
  areaUnavailableLabel: "Hub could not save that region.",
  searchLabel: "Search comments",
  searchPlaceholder: "Search comments",
  filterLabel: "Filters",
  currentBuildFilterLabel: "Current build only",
  currentPageFilterLabel: "Current page only",
  participantFilterLabel: "Participant",
  allParticipantsLabel: "All participants",
  showResolvedLabel: "Show resolved",
  unreadOnlyLabel: "Unread only",
  onlyMineLabel: "Only your threads",
  showPinsLabel: "Show pins",
  sidebarShortcutLabel: "Shift+C",
  loadingLabel: "Loading comments",
  loadErrorLabel: "Comments could not be loaded.",
  retryLabel: "Retry",
  emptyLabel: "No comments have been added.",
  noMatchesLabel: "No comments match these filters.",
  buildLabel: "build %{number}",
  movedAnchorLabel: "Moved",
  changedAnchorLabel: "Context changed",
  missingAnchorLabel: "Not found",
  routeMismatchLabel: "Saved on another page",
  resolvedLabel: "Resolved",
  markerLabel: "Thread started by %{author}",
  markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
  unreadLabel: "Unread",
  unreadMarkerLabel: "Unread thread started by %{author}",
  unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
  replyCountOneLabel: "1 reply",
  replyCountOtherLabel: "%{count} replies",
  threadHeading: "Conversation",
  backToCommentsLabel: "Back to comments",
  resolvedByLabel: "Resolved by %{author}. Reopen this thread to reply.",
  editedLabel: "Edited",
  deletedCommentLabel: "Comment deleted",
  addReactionLabel: "Add reaction",
  reactionCountOneLabel: "%{reaction}, 1 reaction",
  reactionCountOtherLabel: "%{reaction}, %{count} reactions",
  reactionErrorLabel: "The reaction could not be changed.",
  readErrorLabel: "Hub could not mark this conversation as read.",
  markUnreadLabel: "Mark as unread",
  markUnreadErrorLabel: "Hub could not mark this conversation as unread. Try again.",
  reactionLabels: {
    "+1": "Thumbs up",
    "-1": "Thumbs down",
    laugh: "Laugh",
    hooray: "Hooray",
    confused: "Confused",
    heart: "Heart",
    rocket: "Rocket",
    eyes: "Eyes",
  },
  commentActionsLabel: "Actions for comment by %{author}",
  editLabel: "Edit",
  deleteLabel: "Delete",
  editCommentLabel: "Edit comment",
  saveEditLabel: "Save",
  savingEditLabel: "Saving comment",
  cancelEditLabel: "Cancel",
  editErrorLabel: "The comment could not be updated.",
  deleteHeading: "Delete this comment?",
  deletePromptLabel: "Deleted comment text cannot be recovered.",
  confirmDeleteLabel: "Delete",
  deletingLabel: "Deleting comment",
  deleteErrorLabel: "The comment could not be deleted.",
  replyLabel: "Reply",
  replyPlaceholder: "Reply to this conversation",
  replySubmitLabel: "Reply",
  replySubmitTooltipMacLabel: "Reply (Cmd+Return)",
  replySubmitTooltipOtherLabel: "Reply (Ctrl+Enter)",
  replyingLabel: "Saving reply",
  replyErrorLabel: "The reply could not be saved.",
  resolveLabel: "Resolve",
  resolvingLabel: "Resolving thread",
  reopenLabel: "Reopen",
  reopeningLabel: "Reopening thread",
  resolutionErrorLabel: "The thread state could not be changed.",
  resolvedReplyBlockedLabel: "Reopen this thread to reply.",
  deletedReplyBlockedLabel: "Replies are closed.",
  threadDiscardPromptLabel: "Your reply or edit has not been saved.",
  composerHeading: "New comment",
  composerLabel: "Comment",
  composerPlaceholder: "Leave a review comment",
  submitLabel: "Comment",
  submitTooltipMacLabel: "Comment (Cmd+Return)",
  submitTooltipOtherLabel: "Comment (Ctrl+Enter)",
  submittingLabel: "Saving comment",
  closeComposerLabel: "Cancel",
  discardHeading: "Keep this draft?",
  discardPromptLabel: "This comment has not been submitted.",
  keepLabel: "Keep",
  discardButtonLabel: "Discard",
  bodyTooLongLabel: "Comments must be 10000 UTF-8 bytes or fewer.",
  createErrorLabel: "The comment could not be saved.",
}

describe("ReviewCommentComposer()", () => {
  describe.each([
    { platform: "MacIntel", modifier: { metaKey: true }, tooltip: COPY.submitTooltipMacLabel },
    { platform: "Win32", modifier: { ctrlKey: true }, tooltip: COPY.submitTooltipOtherLabel },
  ])("on $platform", ({ platform, modifier, tooltip }) => {
    it("submits the current draft through the form and describes the shortcut", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn().mockResolvedValue(true)
      render(
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={onSubmit}
          onDiscard={vi.fn()}
        />,
      )
      const input = screen.getByRole("textbox", { name: COPY.composerLabel })
      const form = input.closest("form")
      if (!form) throw new Error("Expected comment form")
      const requestSubmit = vi.spyOn(form, "requestSubmit")
      fireEvent.change(input, { target: { value: "A multiline\nreview comment." } })

      expect(screen.getByRole("button", { name: COPY.submitLabel })).toHaveAccessibleDescription(
        tooltip,
      )
      expect(screen.getByText(tooltip)).toHaveAttribute("role", "tooltip")
      expect(fireEvent.keyDown(input, { key: "Enter", ...modifier })).toBe(false)
      expect(requestSubmit).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith("A multiline\nreview comment.")
    })

    it.each([
      { draft: "", creating: false, event: {} },
      { draft: "   ", creating: false, event: {} },
      { draft: "😀😀😀", creating: false, event: {} },
      { draft: "Review", creating: true, event: {} },
      { draft: "Review", creating: false, event: { isComposing: true } },
      { draft: "Review", creating: false, event: { keyCode: 229 } },
      { draft: "Review", creating: false, event: { repeat: true } },
      { draft: "Review", creating: false, event: { shiftKey: true } },
      { draft: "Review", creating: false, event: { altKey: true } },
    ])("does not submit an invalid or guarded shortcut: %j", ({ draft, creating, event }) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn()
      render(
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10}
          copy={COPY}
          creating={creating}
          onSubmit={onSubmit}
          onDiscard={vi.fn()}
        />,
      )
      const input = screen.getByRole("textbox")
      const form = input.closest("form")
      if (!form) throw new Error("Expected comment form")
      const requestSubmit = vi.spyOn(form, "requestSubmit")
      fireEvent.change(input, { target: { value: draft } })
      fireEvent.keyDown(input, { key: "Enter", ...modifier, ...event })
      expect(requestSubmit).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it("leaves ordinary Enter for multiline text and protects a discard confirmation", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn()
      render(
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={onSubmit}
          onDiscard={vi.fn()}
        />,
      )
      const input = screen.getByRole("textbox")
      fireEvent.change(input, { target: { value: "Unfinished comment" } })
      expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true)
      expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true)
      expect(onSubmit).not.toHaveBeenCalled()

      fireEvent.keyDown(input, { key: "Escape" })
      expect(screen.getByRole("button", { name: COPY.keepLabel })).toHaveFocus()
      fireEvent.keyDown(input, { key: "Enter", ...modifier })
      const form = input.closest("form")
      if (!form) throw new Error("Expected comment form")
      fireEvent.submit(form)
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole("button", { name: COPY.keepLabel })).toBeInTheDocument()
    })
  })

  it("requires Keep or Discard before dismissing a nonempty draft", () => {
    const onDiscard = vi.fn()
    render(
      <div style={{ position: "relative", width: 600, height: 500 }}>
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={vi.fn()}
          onDiscard={onDiscard}
        />
      </div>,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Keep this thought." },
    })
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" })
    const cancelButton = cancelButtons[0]
    if (!cancelButton) throw new Error("Expected composer cancel button")
    fireEvent.click(cancelButton)

    expect(screen.getByText("Keep this draft?")).toBeInTheDocument()
    expect(screen.getByText("Keep this draft?").closest(".review-confirmation-panel")).toHaveClass(
      "review-confirmation-panel--condensed",
    )
    const confirmationButtons = screen
      .getByText("Keep this draft?")
      .closest(".review-confirmation-panel")
      ?.querySelectorAll("button")
    expect(Array.from(confirmationButtons ?? [], (button) => button.textContent)).toEqual([
      "Discard",
      "Keep",
    ])
    expect(screen.getByRole("button", { name: "Discard" }).className).toContain("Button--secondary")
    expect(screen.getByRole("button", { name: "Keep" }).className).toContain("Button--primary")
    expect(onDiscard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("Keep this thought.")

    fireEvent.click(cancelButton)
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it("uses small action buttons", () => {
    render(
      <div style={{ position: "relative", width: 600, height: 500 }}>
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={vi.fn()}
          onDiscard={vi.fn()}
        />
      </div>,
    )

    const actions = document.querySelector(".review-comment-composer__actions")
    expect(actions?.querySelectorAll('[class*="Button--size-small"]')).toHaveLength(2)
  })

  it("keeps a draft on outside click and returns focus after Escape", () => {
    const onDiscard = vi.fn()
    const { container } = render(
      <div style={{ position: "relative", width: 600, height: 500 }}>
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={vi.fn()}
          onDiscard={onDiscard}
        />
      </div>,
    )
    const input = screen.getByRole("textbox", { name: "Comment" })
    const backdrop = container.querySelector(".review-comment-composer-backdrop")
    if (!backdrop) throw new Error("Expected composer backdrop")
    fireEvent.change(input, { target: { value: "Don't lose this." } })
    fireEvent.click(backdrop)
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus()
    expect(onDiscard).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole("button", { name: "Keep" }), { key: "Escape" })
    expect(screen.queryByRole("button", { name: "Keep" })).not.toBeInTheDocument()
    expect(input).toHaveValue("Don't lose this.")
    expect(input).toHaveFocus()
  })

  it("dismisses whitespace-only text on outside click and protects in-flight submissions", () => {
    const onDiscard = vi.fn()
    const { container, rerender } = render(
      <div style={{ position: "relative", width: 600, height: 500 }}>
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating={false}
          onSubmit={vi.fn()}
          onDiscard={onDiscard}
        />
      </div>,
    )
    const backdrop = container.querySelector(".review-comment-composer-backdrop")
    if (!backdrop) throw new Error("Expected composer backdrop")
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "   " },
    })
    fireEvent.click(backdrop)
    expect(onDiscard).toHaveBeenCalledOnce()

    rerender(
      <div style={{ position: "relative", width: 600, height: 500 }}>
        <ReviewCommentComposer
          anchorPoint={{ x: 100, y: 100 }}
          bodyMaximumBytes={10_000}
          copy={COPY}
          creating
          onSubmit={vi.fn()}
          onDiscard={onDiscard}
        />
      </div>,
    )
    fireEvent.click(backdrop)
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})
