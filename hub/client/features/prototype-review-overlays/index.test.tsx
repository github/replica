import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { reviewCommentsCopy } from "@utils/review-comment/en"

import { CanvasReviewOverlays } from "."
import story from "./stories"

describe("CanvasReviewOverlays()", () => {
  it("renders the closed-Hub warning and retained thread without a mutation", () => {
    const onReply = vi.fn(() => Promise.resolve(false))
    render(
      <ThemeProvider>
        <CanvasReviewOverlays
          {...story.args}
          conversation={{ ...story.args.conversation, onReply }}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent(story.args.rateLimitNotice)
    expect(screen.getByText(story.args.conversation.thread.root.body!)).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Keep this unsent draft." },
    })
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this unsent draft.")
    expect(onReply).not.toHaveBeenCalled()
  })

  it("clears a notice without remounting the open conversation draft", () => {
    const view = render(
      <ThemeProvider>
        <CanvasReviewOverlays {...story.args} />
      </ThemeProvider>,
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Keep this unsent draft." },
    })
    view.rerender(
      <ThemeProvider>
        <CanvasReviewOverlays {...story.args} rateLimitNotice={null} />
      </ThemeProvider>,
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this unsent draft.")
  })

  it("shows both notices in one alert without clearing the conversation draft", () => {
    render(
      <ThemeProvider>
        <CanvasReviewOverlays
          {...story.args}
          selectionNotice={reviewCommentsCopy.areaTooSmallLabel}
        />
      </ThemeProvider>,
    )
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert")).toHaveTextContent(reviewCommentsCopy.areaTooSmallLabel)
    expect(screen.getByRole("alert")).toHaveTextContent(story.args.rateLimitNotice)
    expect(screen.getByText(story.args.conversation.thread.root.body!)).toBeVisible()
    fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: "Keep this unsent draft." },
    })
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("Keep this unsent draft.")
  })
})
