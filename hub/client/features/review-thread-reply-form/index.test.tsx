import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { ReviewThreadReplyForm } from "."

const defaultProps = {
  blockedLabel: null,
  confirmingDiscard: false,
  replyDraft: "Looks good to me.",
  replyBodyTooLong: false,
  replyFailed: false,
  replyDisabled: false,
  replying: false,
  copy: reviewCommentsCopy,
  onKeepDraft: vi.fn(),
  onDiscardDraft: vi.fn(),
  onSubmit: vi.fn(),
  onDraftChange: vi.fn(),
}

describe("ReviewThreadReplyForm()", () => {
  describe.each([
    {
      platform: "MacIntel",
      modifier: { metaKey: true },
      tooltip: reviewCommentsCopy.replySubmitTooltipMacLabel,
    },
    {
      platform: "Win32",
      modifier: { ctrlKey: true },
      tooltip: reviewCommentsCopy.replySubmitTooltipOtherLabel,
    },
  ])("on $platform", ({ platform, modifier, tooltip }) => {
    it("submits through the form and describes the platform's shortcut", () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn()
      render(<ReviewThreadReplyForm {...defaultProps} onSubmit={onSubmit} />)
      const input = screen.getByRole("textbox")
      const form = input.closest("form")
      if (!form) throw new Error("Expected reply form")
      const requestSubmit = vi.spyOn(form, "requestSubmit")
      expect(
        screen.getByRole("button", { name: reviewCommentsCopy.replySubmitLabel }),
      ).toHaveAccessibleDescription(tooltip)
      expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(tooltip)

      expect(fireEvent.keyDown(input, { key: "Enter", ...modifier })).toBe(false)
      expect(requestSubmit).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it.each([
      { replyDraft: "" },
      { replyDraft: "   " },
      { replyBodyTooLong: true },
      { replyDisabled: true },
      { replying: true },
    ])("guards keyboard and form submission: %j", (overrides) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn()
      render(<ReviewThreadReplyForm {...defaultProps} {...overrides} onSubmit={onSubmit} />)
      const input = screen.getByRole("textbox")
      const form = input.closest("form")
      if (!form) throw new Error("Expected reply form")
      const requestSubmit = vi.spyOn(form, "requestSubmit")
      fireEvent.keyDown(input, { key: "Enter", ...modifier })
      fireEvent.keyDown(input, { key: "Enter" })
      fireEvent.submit(form)
      expect(requestSubmit).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(
        screen.getByRole("button", { name: reviewCommentsCopy.replySubmitLabel }),
      ).toBeDisabled()
    })

    it.each([
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
    ])("does not send while composing, repeating or using extra modifiers: %j", (event) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
      const onSubmit = vi.fn()
      render(<ReviewThreadReplyForm {...defaultProps} onSubmit={onSubmit} />)
      const input = screen.getByRole("textbox")
      fireEvent.keyDown(input, { key: "Enter", ...modifier, ...event })
      fireEvent.keyDown(input, { key: "Enter", ...event })
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  it.each([
    { confirmingDiscard: true },
    { blockedLabel: reviewCommentsCopy.resolvedReplyBlockedLabel },
  ])("does not expose a submit form when replies are blocked: %j", (overrides) => {
    const onSubmit = vi.fn()
    const { container } = render(
      <ReviewThreadReplyForm {...defaultProps} {...overrides} onSubmit={onSubmit} />,
    )
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(container.querySelector("form")).not.toBeInTheDocument()
    fireEvent.keyDown(container, { key: "Enter", metaKey: true })
    fireEvent.keyDown(container, { key: "Enter", ctrlKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("submits on Enter and keeps Shift+Enter for a newline", () => {
    const onSubmit = vi.fn()
    render(<ReviewThreadReplyForm {...defaultProps} onSubmit={onSubmit} />)
    const input = screen.getByRole("textbox", { name: reviewCommentsCopy.replyLabel })

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("keeps errors visible and blocks submission while a reply is pending", () => {
    const onSubmit = vi.fn()
    render(<ReviewThreadReplyForm {...defaultProps} replyFailed replying onSubmit={onSubmit} />)

    const submit = screen.getByRole("button", { name: reviewCommentsCopy.replySubmitLabel })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(reviewCommentsCopy.replyErrorLabel)
    expect(screen.getByRole("status")).toHaveTextContent(reviewCommentsCopy.replyingLabel)
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
