import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewThreadMessage } from "."

const onStartEdit = vi.fn()
const onRequestDelete = vi.fn()

const props = {
  comment: octocatRootComment,
  mutation: null,
  copy: reviewCommentsCopy,
  editing: false,
  editDraft: "",
  editBodyTooLong: false,
  editFailed: false,
  confirmingEditDiscard: false,
  saving: false,
  confirmingDelete: false,
  deleting: false,
  deleteFailed: false,
  actionsDisabled: false,
  onStartEdit,
  onEditDraftChange: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onKeepEdit: vi.fn(),
  onDiscardEdit: vi.fn(),
  onRequestDelete,
  onCancelDelete: vi.fn(),
  onDelete: vi.fn(),
  onAddReaction: vi.fn(() => Promise.resolve(true)),
  onRemoveReaction: vi.fn(() => Promise.resolve(true)),
  onBurstReaction: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe("ReviewThreadMessage()", () => {
  it("keeps the author, compact timestamp, and edited status on one byline", () => {
    render(
      <ReviewThreadMessage
        {...props}
        comment={{ ...octocatRootComment, editedAt: "2026-09-14T14:00:00Z" }}
      />,
    )

    const byline = screen.getByText("The Octocat").closest(".review-thread-message__byline")
    expect(byline).toContainElement(screen.getByRole("time"))
    expect(byline).toHaveTextContent(reviewCommentsCopy.editedLabel)
  })

  it("offers edit and delete through a small Brand action menu", () => {
    render(<ReviewThreadMessage {...props} />)
    const label = "Actions for comment by @octocat"
    const trigger = screen.getByRole("button", { name: label })
    expect(trigger).toHaveAccessibleDescription(label)
    expect(trigger.className).toContain("Button--size-small")
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole("menuitem", { name: reviewCommentsCopy.editLabel }), {
      key: "Enter",
    })
    expect(onStartEdit).toHaveBeenCalledOnce()

    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitem", { name: reviewCommentsCopy.deleteLabel }))
    expect(onRequestDelete).toHaveBeenCalledOnce()
  })

  it("retains a disabled trigger with an accessible description", () => {
    render(<ReviewThreadMessage {...props} actionsDisabled />)
    const trigger = screen.getByRole("button", { name: "Actions for comment by @octocat" })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAccessibleDescription("Actions for comment by @octocat")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
