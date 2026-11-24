import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentControl } from "."

const actions = {
  onCancelSelection: vi.fn(),
  onStartSelection: vi.fn(),
}

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
afterEach(() => vi.unstubAllGlobals())

describe("ReviewCommentControl()", () => {
  it("offers one comment action and the visibility toggle", () => {
    const onStartSelection = vi.fn()
    const onToggle = vi.fn()
    const onCancelSelection = vi.fn()
    const props = {
      bridgeReady: true,
      copy: reviewCommentsCopy,
      selectionBlocked: false,
      onStartSelection,
      onCancelSelection,
      visibilityAction: { label: "Hide comments", onToggle },
    }
    const { rerender } = render(<ReviewCommentControl {...props} selecting={false} />)

    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    expect(screen.getAllByRole("menuitem")).toHaveLength(2)
    const comment = screen.getByRole("menuitem", { name: reviewCommentsCopy.commentMenuLabel })
    expect(comment).toHaveAttribute("aria-keyshortcuts", "C")
    fireEvent.click(comment)
    expect(onStartSelection).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    const visibility = screen.getByRole("menuitem", { name: "Hide comments" })
    expect(visibility).not.toHaveAttribute("aria-keyshortcuts")
    fireEvent.click(visibility)
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(<ReviewCommentControl {...props} selecting />)
    const cancel = screen.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
    expect(cancel).toHaveAttribute("aria-keyshortcuts", "C")
    fireEvent.click(cancel)
    expect(onCancelSelection).toHaveBeenCalledOnce()
  })

  it("aligns the comment icon as a Brand leading visual and describes the menu trigger", () => {
    render(
      <ReviewCommentControl
        bridgeReady
        copy={reviewCommentsCopy}
        selectionBlocked={false}
        selecting={false}
        {...actions}
      />,
    )

    const trigger = screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel })
    expect(trigger.querySelector('[data-testid="Button-leading-visual"] svg')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleDescription(reviewCommentsCopy.commentMenuLabel)
    expect(trigger).not.toHaveAttribute("title")
    fireEvent.click(trigger)
    expect(
      trigger
        .closest<HTMLElement>('[data-testid="ActionMenu"]')
        ?.style.getPropertyValue("--review-comment-control-menu-height"),
    ).not.toBe("")
    const comment = screen.getByRole("menuitem", { name: reviewCommentsCopy.commentMenuLabel })
    expect(comment).toHaveAttribute("aria-keyshortcuts", "C")
    fireEvent.keyDown(comment, { key: "Enter" })
    expect(actions.onStartSelection).toHaveBeenCalledOnce()
  })

  it("preserves the unavailable reason and describes the cancel-selection action", () => {
    const { rerender } = render(
      <ReviewCommentControl
        bridgeReady={false}
        copy={reviewCommentsCopy}
        selectionBlocked={false}
        selecting={false}
        {...actions}
      />,
    )

    const unavailable = screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel })
    expect(unavailable.closest("[title]")).toHaveAttribute(
      "title",
      reviewCommentsCopy.bridgeUnavailableLabel,
    )
    expect(unavailable).toHaveAccessibleDescription(reviewCommentsCopy.bridgeUnavailableLabel)
    rerender(
      <ReviewCommentControl
        bridgeReady
        copy={reviewCommentsCopy}
        selectionBlocked={false}
        selecting
        {...actions}
      />,
    )

    const cancel = screen.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
    expect(cancel).toHaveAccessibleDescription(reviewCommentsCopy.cancelSelectionLabel)
    expect(cancel).toHaveAttribute("aria-pressed", "true")
    expect(cancel).toHaveClass("review-comment-control__trigger")
  })
})
