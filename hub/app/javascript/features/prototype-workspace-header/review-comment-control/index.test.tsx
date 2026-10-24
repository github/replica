import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewCommentControl } from "."

const actions = {
  onCancelSelection: vi.fn(),
  onStartAreaSelection: vi.fn(),
  onStartElementSelection: vi.fn(),
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

describe("ReviewCommentControl()", () => {
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
    expect(
      screen.getByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
    ).toHaveAttribute("aria-keyshortcuts", "C")
    fireEvent.keyDown(
      screen.getByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
      { key: "Enter" },
    )
    expect(actions.onStartElementSelection).toHaveBeenCalledOnce()
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
