import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReviewCommentsCopy, ReviewThread } from "@utils/review-comment/types"
import { ReviewCommentMarkers } from "@features/review-comment-markers"

import { ReviewThreadConversation } from "."
import type { ReviewThreadConversationProps } from "./types"

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
  markUnreadErrorLabel: "Hub could not mark this conversation as unread.",
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

const THREAD: ReviewThread = {
  root: {
    id: 1,
    kind: "root",
    buildNumber: 2,
    buildPath: "/repositories/2001/prototypes/1?build=2",
    body: "Root comment",
    anchor: {
      schemaVersion: 1,
      kind: "element",
      route: { pathname: "/", search: "", hash: "" },
      selector: "#save",
      accessibleName: "Save",
      tagName: "button",
      selectedText: "",
      rect: { x: 20, y: 30, width: 100, height: 32 },
      viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
      elementOffset: { x: 0.5, y: 0.5 },
    },
    createdAt: "2026-09-14T12:00:00Z",
    updatedAt: "2026-09-14T12:00:00Z",
    editedAt: null,
    deletedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    activityVersion: 1,
    viewerLastSeenActivityVersion: 1,
    author: { login: "octocat", name: "The Octocat", avatarUrl: null },
    viewerCanEdit: true,
    viewerCanDelete: true,
    reactions: [],
  },
  replies: [],
  participants: [{ login: "octocat", name: "The Octocat", avatarUrl: null }],
  lastActivityAt: "2026-09-14T12:00:00Z",
  unread: false,
}

function renderConversation(
  overrides: Partial<ReviewThreadConversationProps> = {},
  withMarkers: "hub" | "canvas" | false = false,
) {
  const callbacks = {
    onClose: vi.fn(),
    onDraftStateChange: vi.fn(),
    onReply: vi.fn(() => Promise.resolve(true)),
    onEdit: vi.fn(() => Promise.resolve(true)),
    onDelete: vi.fn(() => Promise.resolve(true)),
    onResolve: vi.fn(() => Promise.resolve(true)),
    onReopen: vi.fn(() => Promise.resolve(true)),
    onAddReaction: vi.fn(() => Promise.resolve(true)),
    onRemoveReaction: vi.fn(() => Promise.resolve(true)),
    onMarkRead: vi.fn(() => Promise.resolve(true)),
    onMarkUnread: vi.fn(() => Promise.resolve(true)),
  }
  const initialThread = overrides.thread ?? THREAD
  function conversation(thread: ReviewThread) {
    return (
      <div style={{ position: "relative", width: 900, height: 700 }}>
        {withMarkers && overrides.anchorPoint ? (
          <div className={withMarkers === "canvas" ? "canvas-marker-layer" : undefined}>
            <ReviewCommentMarkers
              threads={[thread]}
              resolutions={
                new Map([
                  [
                    thread.root.id,
                    {
                      commentId: thread.root.id,
                      status: "resolved",
                      point: overrides.anchorPoint,
                      rect: { x: 0, y: 0, width: 900, height: 700 },
                    },
                  ],
                ])
              }
              selectedThreadId={thread.root.id}
              selectionBlocked={false}
              focusSelectedMarker={false}
              copy={COPY}
              onSelect={vi.fn()}
            />
          </div>
        ) : null}
        <div
          className={
            withMarkers === "canvas"
              ? "canvas-conversation-shell"
              : "review-thread-conversation-layer"
          }
        >
          <ReviewThreadConversation
            anchorPoint={{ x: 100, y: 100 }}
            bodyMaximumBytes={10_000}
            mutation={null}
            copy={COPY}
            {...callbacks}
            {...overrides}
            thread={thread}
          />
        </div>
      </div>
    )
  }
  const rendered = render(conversation(initialThread))
  return {
    ...callbacks,
    unmount: rendered.unmount,
    refreshThread: (thread: ReviewThread) => rendered.rerender(conversation(thread)),
  }
}

describe("ReviewThreadConversation()", () => {
  it.each(["returned", "rejected"])(
    "shows a %s reaction failure during editing and after canceling",
    async (failure) => {
      let finishAdd: ((saved: boolean) => void) | undefined
      let rejectAdd: ((error: Error) => void) | undefined
      const onAddReaction = vi.fn(
        () =>
          new Promise<boolean>((resolve, reject) => {
            finishAdd = resolve
            rejectAdd = reject
          }),
      )
      renderConversation({ onAddReaction })

      fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
      fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
      expect(screen.getByRole("button", { name: "Thumbs up, 1 reaction" })).toHaveAttribute(
        "aria-pressed",
        "true",
      )
      fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
      const editor = screen.getByRole("textbox", { name: "Edit comment" })
      expect(editor).toHaveFocus()
      expect(screen.queryByRole("button", { name: "Add reaction" })).not.toBeInTheDocument()

      await act(async () => {
        if (failure === "rejected") rejectAdd?.(new Error("Offline"))
        else finishAdd?.(false)
        await Promise.resolve()
      })
      expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel)
      expect(editor).toHaveFocus()
      expect(editor).toHaveValue("Root comment")

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(screen.queryByRole("textbox", { name: "Edit comment" })).not.toBeInTheDocument()
      expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel)
      expect(
        screen.queryByRole("button", { name: "Thumbs up, 1 reaction" }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Add reaction" })).toBeEnabled()
      expect(onAddReaction).toHaveBeenCalledOnce()

      fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
      fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(onAddReaction).toHaveBeenCalledTimes(2)
      await act(async () => {
        finishAdd?.(true)
        await Promise.resolve()
      })
    },
  )

  it("retains a pending reaction removal when an edit is opened and canceled", async () => {
    let finishRemove: ((saved: boolean) => void) | undefined
    const onRemoveReaction = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRemove = resolve
        }),
    )
    const { refreshThread } = renderConversation({
      thread: {
        ...THREAD,
        root: {
          ...THREAD.root,
          reactions: [{ content: "heart", count: 2, viewerHasReacted: true }],
        },
      },
      onRemoveReaction,
    })
    fireEvent.click(screen.getByRole("button", { name: "Heart, 2 reactions" }))
    expect(screen.getByRole("button", { name: "Heart, 1 reaction" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    refreshThread({
      ...THREAD,
      root: {
        ...THREAD.root,
        reactions: [{ content: "heart", count: 3, viewerHasReacted: true }],
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    const pendingReaction = screen.getByRole("button", { name: "Heart, 2 reactions" })
    expect(pendingReaction).toHaveAttribute("aria-pressed", "false")
    expect(pendingReaction).toHaveAttribute("aria-busy", "true")
    fireEvent.click(pendingReaction)
    expect(onRemoveReaction).toHaveBeenCalledOnce()

    await act(async () => {
      finishRemove?.(false)
      await Promise.resolve()
    })
    expect(screen.getByRole("button", { name: "Heart, 3 reactions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel)
  })

  it("keeps comment menus mounted during reactions but blocks conflicting saves", () => {
    renderConversation({
      mutation: { kind: "add-reaction", commentId: THREAD.root.id, content: "heart" },
    })
    const menu = screen.getByRole("button", { name: "Actions for comment by @octocat" })
    expect(menu).toBeEnabled()
    expect(screen.getByRole("button", { name: "Add reaction" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Resolve" })).toBeDisabled()
    fireEvent.click(menu)
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    expect(screen.getByRole("textbox", { name: "Edit comment" })).toHaveValue("Root comment")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
  it.each(["hub", "canvas"] as const)(
    "stays beside the shifted first avatar as a right-edge stack and %s preview resize",
    (layout) => {
      let previewWidth = 900
      const observers = new Set<() => void>()
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private callback: () => void) {
            observers.add(callback)
          }
          observe() {}
          disconnect() {
            observers.delete(this.callback)
          }
        },
      )
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(previewWidth)
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700)
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        if (this.classList.contains("review-thread-conversation")) return 384
        if (this.classList.contains("review-comment-marker"))
          return 44 + 20 * (this.querySelectorAll(".review-participant-stack__avatar").length - 1)
        return 0
      })
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300)
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const marker = this.classList.contains("review-comment-marker")
        const shell = this.classList.contains(
          layout === "canvas" ? "canvas-conversation-shell" : "review-thread-conversation-layer",
        )
        const left = marker
          ? 20 +
            Number.parseFloat(this.style.left) -
            16 +
            Number.parseFloat(this.style.getPropertyValue("--review-marker-offset-x") || "0")
          : shell
            ? 20
            : 0
        const top = marker ? 60 + Number.parseFloat(this.style.top) - 16 : shell ? 60 : 0
        const width = marker ? this.offsetWidth : previewWidth
        const height = marker ? 32 : 700
        return {
          x: left,
          y: top,
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
          toJSON: () => ({}),
        }
      })
      const thread = {
        ...THREAD,
        participants: [
          THREAD.root.author,
          { login: "second", name: null, avatarUrl: null },
          { login: "third", name: null, avatarUrl: null },
        ],
      }
      const callbacks = renderConversation({ thread, anchorPoint: { x: 896, y: 100 } }, layout)
      const marker = document.querySelector<HTMLElement>(".review-comment-marker")!
      const card = screen.getByRole("dialog")
      function expectBesideAvatar() {
        expect(Number.parseFloat(card.style.getPropertyValue("--review-thread-left")) + 384).toBe(
          marker.getBoundingClientRect().left - 20 - 12,
        )
        expect(card.style.getPropertyValue("--review-thread-top")).toBe("84px")
      }
      expect(marker.style.getPropertyValue("--review-marker-offset-x")).toBe("-64px")
      expectBesideAvatar()

      callbacks.refreshThread({
        ...thread,
        participants: [...thread.participants, { login: "fourth", name: null, avatarUrl: null }],
      })
      expect(marker.style.getPropertyValue("--review-marker-offset-x")).toBe("-84px")
      expectBesideAvatar()

      previewWidth = 720
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(previewWidth)
      act(() => {
        for (const callback of observers) callback()
      })
      expect(marker.style.getPropertyValue("--review-marker-offset-x")).toBe("-264px")
      expectBesideAvatar()
    },
  )

  it.each([
    { login: "reviewer", name: "Jan Six", avatarUrl: null },
    { login: "reviewer", name: null, avatarUrl: null },
    null,
  ])("shows one localized resolved message below the comments with resolver %j", (resolvedBy) => {
    renderConversation({
      thread: {
        ...THREAD,
        root: { ...THREAD.root, resolvedAt: "2026-10-08T10:00:00Z", resolvedBy },
      },
    })
    const label = resolvedBy
      ? `Resolved by ${resolvedBy.name || `@${resolvedBy.login}`}. Reopen this thread to reply.`
      : COPY.resolvedReplyBlockedLabel
    const message = screen.getByText(label)
    expect(message.closest(".review-thread-conversation__footer")).not.toBeNull()
    expect(document.querySelector(".review-thread-conversation__resolution")).toBeNull()
    expect(screen.getAllByText(label)).toHaveLength(1)
    expect(screen.queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reopen" })).toBeEnabled()
  })

  it("uses supplied resolution copy and keeps deleted-thread messaging separate", () => {
    const thread = {
      ...THREAD,
      root: {
        ...THREAD.root,
        resolvedAt: "2026-10-08T10:00:00Z",
        resolvedBy: { login: "reviewer", name: "Jan Six", avatarUrl: null },
      },
    }
    const callbacks = renderConversation({
      thread,
      copy: { ...COPY, resolvedByLabel: "Closed by %{author}. Reopen to continue." },
    })
    expect(screen.getByText("Closed by Jan Six. Reopen to continue.")).toBeInTheDocument()
    callbacks.refreshThread({
      ...thread,
      root: { ...thread.root, deletedAt: "2026-10-08T10:05:00Z" },
    })
    expect(screen.getByText(COPY.deletedReplyBlockedLabel)).toBeInTheDocument()
    expect(screen.queryByText("Closed by Jan Six. Reopen to continue.")).not.toBeInTheDocument()
  })

  it("dismisses a saved conversation from outside focus without deleting it", () => {
    const callbacks = renderConversation()
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onDelete).not.toHaveBeenCalled()
  })

  it("dismisses after a successful reply when focus moves into the preview", async () => {
    const callbacks = renderConversation()
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Saved reply" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Reply" }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue(""))
    act(() => {
      window.dispatchEvent(new Event("replica:review-dismiss"))
    })
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(callbacks.onDelete).not.toHaveBeenCalled()
  })

  it("keeps an ordinary conversation open for pointer focus inside the preview", () => {
    const callbacks = renderConversation()
    const previewInput = document.createElement("input")
    document.body.append(previewInput)
    act(() => previewInput.focus())

    act(() => {
      window.dispatchEvent(
        new CustomEvent("replica:review-dismiss", {
          detail: { restoreFocus: false },
        }),
      )
    })

    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(previewInput)
    previewInput.remove()
  })

  it("protects an unfinished reply when Escape comes from the preview", () => {
    const callbacks = renderConversation()
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Still writing" },
    })
    act(() => {
      window.dispatchEvent(new Event("replica:review-dismiss"))
    })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(screen.getByText("Your reply or edit has not been saved.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Still writing")
  })

  it("protects a changed edit when Escape comes from outside the conversation", () => {
    const callbacks = renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Unsaved edit" },
    })
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(screen.getByText("Your reply or edit has not been saved.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(screen.getByRole("textbox", { name: "Edit comment" })).toHaveValue("Unsaved edit")
  })

  it("does not dismiss a pending save or another open dialog", () => {
    const callbacks = renderConversation({ mutation: { kind: "reply", commentId: 1 } })
    fireEvent.keyDown(document.body, { key: "Escape" })
    act(() => {
      window.dispatchEvent(new Event("replica:review-dismiss"))
    })
    const dialog = document.createElement("dialog")
    document.body.append(dialog)
    fireEvent.keyDown(dialog, { key: "Escape" })
    dialog.remove()
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it.each(["outside focus", "the preview"])(
    "does not dismiss the conversation while a menu is open when Escape comes from %s",
    (source) => {
      const callbacks = renderConversation()
      fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
      if (source === "outside focus") {
        fireEvent.keyDown(document.body, { key: "Escape" })
      } else {
        act(() => {
          window.dispatchEvent(new Event("replica:review-dismiss"))
        })
        expect(screen.getByRole("menu")).toBeInTheDocument()
      }
      expect(callbacks.onClose).not.toHaveBeenCalled()
    },
  )

  it("leaves Escape inside another dialog alone when no save is pending", () => {
    const callbacks = renderConversation()
    const dialog = document.createElement("dialog")
    dialog.open = true
    dialog.tabIndex = -1
    document.body.append(dialog)
    act(() => dialog.focus())
    fireEvent.keyDown(dialog, { key: "Escape" })
    act(() => {
      window.dispatchEvent(new Event("replica:review-dismiss"))
    })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    dialog.remove()
  })

  it("places the conversation beside an upper-right avatar instead of a large target", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700)
    renderConversation({ anchorPoint: { x: 940, y: 72 } })
    expect(screen.getByRole("dialog").style.getPropertyValue("--review-thread-left")).toBe("592px")
    expect(screen.getByRole("dialog").style.getPropertyValue("--review-thread-top")).toBe("56px")
  })

  it("clamps a bottom-right conversation inside the preview", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700)
    renderConversation({ anchorPoint: { x: 940, y: 650 } })
    expect(screen.getByRole("dialog").style.getPropertyValue("--review-thread-left")).toBe("592px")
    expect(screen.getByRole("dialog").style.getPropertyValue("--review-thread-top")).toBe("292px")
  })

  it("places Resolve before the close button at the right of the header", () => {
    renderConversation()
    const header = screen.getByRole("heading", { name: "Conversation" }).closest("header")

    expect(
      [...header!.querySelectorAll("button")].map(
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual(["Resolve", "Back to comments"])
  })

  it("saves replies and protects an unfinished reply when closing", async () => {
    const callbacks = renderConversation()
    const reply = screen.getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "I updated this." } })
    fireEvent.click(screen.getByRole("button", { name: "Back to comments" }))

    expect(screen.getByText("Your reply or edit has not been saved.")).toBeInTheDocument()
    expect(callbacks.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("I updated this.")

    fireEvent.click(screen.getByRole("button", { name: "Reply" }))

    await waitFor(() => expect(callbacks.onReply).toHaveBeenCalledWith("I updated this."))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue(""))
  })

  it("edits, deletes, and resolves through explicit thread actions", async () => {
    const callbacks = renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Edited root" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(callbacks.onEdit).toHaveBeenCalledWith(1, "Edited root"))
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Edit comment" })).not.toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(screen.getByText("Deleted comment text cannot be recovered.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledWith(1))
    await waitFor(() =>
      expect(
        screen.queryByText("Deleted comment text cannot be recovered."),
      ).not.toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    await waitFor(() => expect(callbacks.onResolve).toHaveBeenCalledOnce())
  })

  it("confirms before discarding a changed edit and restores the textarea on Keep", () => {
    const callbacks = renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    const input = screen.getByRole("textbox", { name: "Edit comment" })
    fireEvent.change(input, { target: { value: "Keep my revised wording." } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus()
    expect(input).toHaveValue("Keep my revised wording.")
    expect(callbacks.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole("button", { name: "Keep" }), { key: "Escape" })
    expect(input).toHaveFocus()
    expect(input).toHaveValue("Keep my revised wording.")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(screen.queryByRole("textbox", { name: "Edit comment" })).not.toBeInTheDocument()
  })

  it("does not ask to discard an unchanged edit", () => {
    renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("button", { name: "Keep" })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Edit comment" })).not.toBeInTheDocument()
  })

  it("marks the displayed activity version as read", async () => {
    const onMarkRead = vi.fn(() => Promise.resolve(true))
    renderConversation({
      thread: {
        ...THREAD,
        root: {
          ...THREAD.root,
          activityVersion: 2,
          viewerLastSeenActivityVersion: 1,
        },
        unread: true,
      },
      onMarkRead,
    })

    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith(2))
    expect(onMarkRead).toHaveBeenCalledOnce()
  })

  it("puts Mark as unread first and separates Delete from the other root actions", () => {
    renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    const menu = screen.getByRole("menu")
    const items = within(menu).getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Mark as unread", "Edit", "Delete"])
    const divider = within(menu).getByRole("separator")
    expect(
      items[1]!.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      divider.compareDocumentPosition(items[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("offers unread on another author's root but not on a reply", async () => {
    const onMarkUnread = vi.fn(() => Promise.resolve(true))
    renderConversation({
      onMarkUnread,
      thread: {
        ...THREAD,
        root: { ...THREAD.root, viewerCanEdit: false, viewerCanDelete: false },
        replies: [
          {
            id: 2,
            kind: "reply",
            rootId: THREAD.root.id,
            body: "My reply",
            createdAt: "2026-09-14T13:00:00Z",
            updatedAt: "2026-09-14T13:00:00Z",
            editedAt: null,
            deletedAt: null,
            author: { login: "mona", name: "Mona", avatarUrl: null },
            viewerCanEdit: true,
            viewerCanDelete: true,
            reactions: [],
          },
        ],
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Mark as unread",
    ])
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
    await waitFor(() => expect(onMarkUnread).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @mona" }))
    expect(screen.queryByRole("menuitem", { name: "Mark as unread" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument()
  })

  it("keeps manual unread state while open and marks read again after reopening", async () => {
    const onMarkRead = vi.fn(() => Promise.resolve(true))
    const onMarkUnread = vi.fn(() => Promise.resolve(true))
    const conversation = renderConversation({ onMarkRead, onMarkUnread })
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
    await waitFor(() => expect(onMarkUnread).toHaveBeenCalledOnce())
    const unread = {
      ...THREAD,
      root: { ...THREAD.root, viewerLastSeenActivityVersion: null },
      unread: true,
    }
    conversation.refreshThread(unread)
    await act(async () => {})
    expect(screen.getByRole("dialog", { name: "Conversation" })).toBeInTheDocument()
    expect(conversation.onClose).not.toHaveBeenCalled()
    expect(onMarkRead).not.toHaveBeenCalled()
    conversation.unmount()
    renderConversation({ thread: unread, onMarkRead })
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith(1))
    expect(onMarkRead).toHaveBeenCalledOnce()
  })

  it("waits for the opening read acknowledgement before allowing manual unread", async () => {
    let finishRead: ((saved: boolean) => void) | undefined
    const onMarkRead = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRead = resolve
        }),
    )
    const onMarkUnread = vi.fn(() => Promise.resolve(true))
    renderConversation({
      thread: {
        ...THREAD,
        root: { ...THREAD.root, viewerLastSeenActivityVersion: null },
        unread: true,
      },
      onMarkRead,
      onMarkUnread,
    })
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
    expect(onMarkUnread).not.toHaveBeenCalled()
    await act(async () => {
      finishRead?.(true)
      await Promise.resolve()
    })
    if (!screen.queryByRole("menuitem", { name: "Mark as unread" })) {
      fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
    await waitFor(() => expect(onMarkUnread).toHaveBeenCalledOnce())
  })

  it.each(["returned", "rejected"])(
    "shows a %s unread failure and allows retry without losing the reply draft",
    async (failure) => {
      const onMarkUnread = vi.fn<() => Promise<boolean>>()
      if (failure === "returned") onMarkUnread.mockResolvedValueOnce(false)
      else onMarkUnread.mockRejectedValueOnce(new Error("Network unavailable"))
      onMarkUnread.mockResolvedValueOnce(true)
      const conversation = renderConversation({ onMarkUnread })
      fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
        target: { value: "Unsaved reply" },
      })
      fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
      expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute(
        "aria-disabled",
        "true",
      )
      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
        "aria-disabled",
        "true",
      )
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(COPY.markUnreadErrorLabel),
      )
      expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Unsaved reply")
      fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
      await waitFor(() => expect(onMarkUnread).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
      conversation.refreshThread({
        ...THREAD,
        root: { ...THREAD.root, viewerLastSeenActivityVersion: null },
        unread: true,
      })
      expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Unsaved reply")
      expect(conversation.onClose).not.toHaveBeenCalled()
    },
  )

  it("preserves an edit draft when marking the conversation unread", async () => {
    const conversation = renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Unsaved edit" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as unread" }))
    await waitFor(() => expect(conversation.onMarkUnread).toHaveBeenCalledOnce())
    conversation.refreshThread({
      ...THREAD,
      root: { ...THREAD.root, viewerLastSeenActivityVersion: null },
      unread: true,
    })
    expect(screen.getByRole("textbox", { name: "Edit comment" })).toHaveValue("Unsaved edit")
  })

  it("keeps newer live activity unread while the conversation stays open", async () => {
    const conversation = renderConversation({
      thread: {
        ...THREAD,
        root: {
          ...THREAD.root,
          activityVersion: 2,
          viewerLastSeenActivityVersion: 1,
        },
        unread: true,
      },
    })
    await waitFor(() => expect(conversation.onMarkRead).toHaveBeenCalledWith(2))

    conversation.refreshThread({
      ...THREAD,
      root: {
        ...THREAD.root,
        activityVersion: 3,
        viewerLastSeenActivityVersion: 2,
      },
      unread: true,
    })

    await waitFor(() => expect(conversation.onMarkRead).toHaveBeenCalledOnce())
  })

  it("preserves reply and edit drafts when refreshed thread data renders", () => {
    const replyConversation = renderConversation()
    const reply = screen.getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "Unsaved reply" } })

    replyConversation.refreshThread({
      ...THREAD,
      root: { ...THREAD.root, body: "Refreshed root" },
    })
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Unsaved reply")

    replyConversation.refreshThread(THREAD)
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Unsaved edit" },
    })

    replyConversation.refreshThread({
      ...THREAD,
      root: {
        ...THREAD.root,
        reactions: [{ content: "heart", count: 1, viewerHasReacted: false }],
      },
    })
    expect(screen.getByRole("textbox", { name: "Edit comment" })).toHaveValue("Unsaved edit")
  })

  it("preserves an open reaction menu when refreshed thread data renders", () => {
    const conversation = renderConversation()
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    expect(screen.getByRole("menuitem", { name: /Thumbs up/ })).toBeInTheDocument()

    conversation.refreshThread({
      ...THREAD,
      root: {
        ...THREAD.root,
        reactions: [{ content: "heart", count: 1, viewerHasReacted: false }],
      },
    })

    expect(screen.getByRole("menuitem", { name: /Thumbs up/ })).toBeInTheDocument()
  })

  it("keeps the conversation open when Escape closes a reaction menu", () => {
    const callbacks = renderConversation()

    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Thumbs up/ }), {
      key: "Escape",
    })

    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it.each([
    ["Actions for comment by @octocat", "Edit"],
    ["Add reaction", "Thumbs up"],
  ])("keeps the %s menu anchored while messages scroll", (triggerLabel, itemLabel) => {
    renderConversation()
    const trigger = screen.getByRole("button", { name: triggerLabel })
    fireEvent.click(trigger)
    expect(
      trigger
        .closest<HTMLElement>('[data-testid="ActionMenu"]')
        ?.style.getPropertyValue("--review-thread-menu-room-bottom"),
    ).not.toBe("")

    const messages = document.querySelector<HTMLElement>(".review-thread-conversation__messages")
    const menu = screen.getByRole("menu")
    const item = screen.getByRole("menuitem", { name: new RegExp(itemLabel) })
    expect(messages).not.toBeNull()
    act(() => item.focus())
    const originalTop = Number.parseFloat(menu.style.top)

    messages!.scrollTop = 40
    fireEvent.scroll(messages!)
    expect(Number.parseFloat(menu.style.top)).toBe(originalTop - 40)
    expect(item).toHaveFocus()

    messages!.scrollTop = 0
    fireEvent.scroll(messages!)
    expect(Number.parseFloat(menu.style.top)).toBe(originalTop)

    expect(item).toHaveFocus()
  })

  it.each([
    ["Actions for comment by @octocat", "Edit"],
    ["Add reaction", "Thumbs up"],
  ])("starts tracking the %s menu at its opening scroll position", (triggerLabel, itemLabel) => {
    renderConversation()
    const messages = document.querySelector<HTMLElement>(".review-thread-conversation__messages")!
    const trigger = screen.getByRole("button", { name: triggerLabel })

    messages.scrollTop = 40
    fireEvent.click(trigger)
    const firstMenu = screen.getByRole("menu")
    const firstTop = Number.parseFloat(firstMenu.style.top)
    messages.scrollTop = 60
    fireEvent.scroll(messages)
    expect(Number.parseFloat(firstMenu.style.top)).toBe(firstTop - 20)

    fireEvent.click(trigger)
    expect(screen.queryByRole("menuitem", { name: new RegExp(itemLabel) })).not.toBeInTheDocument()
    messages.scrollTop = 80
    fireEvent.click(trigger)
    const reopenedMenu = screen.getByRole("menu")
    const reopenedTop = Number.parseFloat(reopenedMenu.style.top)
    messages.scrollTop = 90
    fireEvent.scroll(messages)
    expect(Number.parseFloat(reopenedMenu.style.top)).toBe(reopenedTop - 10)
    expect(screen.getByRole("menuitem", { name: new RegExp(itemLabel) })).toBeInTheDocument()
  })

  it("keeps an open menu anchored after a live comment refresh", () => {
    const conversation = renderConversation()
    const messages = document.querySelector<HTMLElement>(".review-thread-conversation__messages")!
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    const menu = screen.getByRole("menu")
    const originalTop = Number.parseFloat(menu.style.top)
    messages.scrollTop = 40
    fireEvent.scroll(messages)
    expect(Number.parseFloat(menu.style.top)).toBe(originalTop - 40)

    conversation.refreshThread({
      ...THREAD,
      root: { ...THREAD.root, body: "Updated while the picker stays open" },
    })
    expect(screen.getByRole("menu")).toBe(menu)
    expect(Number.parseFloat(menu.style.top)).toBe(originalTop - 40)
  })

  it("closes a menu whose trigger scrolls out of the messages pane", () => {
    renderConversation()
    const messages = document.querySelector<HTMLElement>(".review-thread-conversation__messages")!
    const trigger = screen.getByRole("button", { name: "Actions for comment by @octocat" })
    vi.spyOn(messages, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 250,
      height: 150,
    } as DOMRect)
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: 60, bottom: 92 } as DOMRect)
    fireEvent.click(trigger)
    act(() => screen.getByRole("menuitem", { name: "Edit" }).focus())

    messages.scrollTop = 40
    fireEvent.scroll(messages)

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back to comments" })).toHaveFocus()
  })
})
