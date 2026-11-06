import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { PrototypeReviewControls } from "."
import type { PrototypeReviewControlsProps } from "./types"

const props: PrototypeReviewControlsProps = {
  bridgeReady: true,
  commentCount: 1,
  copy: reviewCommentsCopy,
  hasUnreadComments: false,
  selectionBlocked: false,
  selecting: false,
  sidebarToggleBlocked: false,
  sidebarOpen: true,
  onCancelSelection: vi.fn(),
  onStartAreaSelection: vi.fn(),
  onStartElementSelection: vi.fn(),
  onToggleSidebar: vi.fn(),
}

describe("PrototypeReviewControls()", () => {
  it("keeps the existing group, count control and sidebar action", () => {
    render(<PrototypeReviewControls {...props} />)
    expect(screen.getByRole("group", { name: reviewCommentsCopy.heading })).toHaveClass(
      "review-shell__comment-actions",
    )
    const comments = screen.getByRole("button", { name: "Comments, 1" })
    expect(comments).toHaveClass("review-shell__comments-toggle")
    expect(comments).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(comments)
    expect(props.onToggleSidebar).toHaveBeenCalledOnce()
  })

  it("disables the count when the header has no selected Build", () => {
    render(<PrototypeReviewControls {...props} noBuild />)
    expect(screen.getByRole("button", { name: "Comments, 1" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }),
    ).not.toBeDisabled()
  })
})
