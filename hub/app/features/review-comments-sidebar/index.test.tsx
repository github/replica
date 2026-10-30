import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { defaultReviewFilters, repliedReviewThread } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentsSidebar } from "."
import type { ReviewCommentsSidebarProps } from "./types"

const props: ReviewCommentsSidebarProps = {
  threads: [],
  currentBuildNumber: 1,
  totalCount: 0,
  hasThreads: false,
  filters: defaultReviewFilters,
  participants: [],
  resolutions: new Map(),
  selectedThreadId: null,
  selectionBlocked: false,
  closeBlocked: false,
  showPins: true,
  loading: false,
  loadFailed: false,
  copy: reviewCommentsCopy,
  onClose: vi.fn(),
  onFiltersChange: vi.fn(),
  onShowPinsChange: vi.fn(),
  onRetry: vi.fn(),
  onSelect: vi.fn(),
}

describe("ReviewCommentsSidebar()", () => {
  it("uses the shared animated frame in the canvas without nesting sidebars", () => {
    const onClose = vi.fn()
    const { container } = render(
      <ReviewCommentsSidebar {...props} frame={{ open: true }} onClose={onClose} />,
    )
    expect(container.querySelectorAll("aside")).toHaveLength(1)
    expect(screen.getByRole("complementary", { name: reviewCommentsCopy.heading })).toHaveClass(
      "hub-sidebar",
    )
    const close = screen.getByRole("button", { name: reviewCommentsCopy.closeLabel })
    expect(close).toHaveClass("hub-icon-button--invisible")
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("uses the small borderless close control and calls the close action", () => {
    const onClose = vi.fn()
    render(<ReviewCommentsSidebar {...props} onClose={onClose} />)

    const close = screen.getByRole("button", { name: reviewCommentsCopy.closeLabel })
    expect(close).toHaveClass("review-comments-sidebar__close")
    expect(close.className).toContain("Button--size-small")
    expect(close.className).toContain("Button--subtle")
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps the disabled close control labeled without calling the action", () => {
    const onClose = vi.fn()
    render(<ReviewCommentsSidebar {...props} closeBlocked onClose={onClose} />)

    const close = screen.getByRole("button", { name: reviewCommentsCopy.closeLabel })
    expect(close).toBeDisabled()
    expect(close).toHaveAccessibleDescription(reviewCommentsCopy.closeLabel)
    fireEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("keeps the selected comment active and selectable when another selection is blocked", () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <ReviewCommentsSidebar
        {...props}
        threads={[repliedReviewThread]}
        selectedThreadId={repliedReviewThread.root.id}
        selectionBlocked
        onSelect={onSelect}
      />,
    )

    const selected = screen.getByRole("button", { pressed: true })
    expect(selected.closest("article")).toHaveClass("review-comment-row--selected")
    expect(selected).toBeEnabled()
    fireEvent.click(selected)
    expect(onSelect).toHaveBeenCalledWith(repliedReviewThread)

    rerender(
      <ReviewCommentsSidebar
        {...props}
        threads={[repliedReviewThread]}
        selectedThreadId={null}
        selectionBlocked
        onSelect={onSelect}
      />,
    )
    expect(screen.getByRole("button", { pressed: false })).toBeDisabled()
  })
})
