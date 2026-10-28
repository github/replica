import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { PrototypeCanvasThreadSample } from "."
import { copy } from "./en"
import { sampleThreads } from "./fixtures"

describe("PrototypeCanvasThreadSample()", () => {
  it("exposes an accessible actions menu", () => {
    render(<PrototypeCanvasThreadSample />)
    const trigger = screen.getByRole("button", { name: `${copy.actions}: 1` })
    expect(trigger).toHaveAccessibleName(`${copy.actions}: 1`)
    fireEvent.click(trigger)
    expect(screen.getByRole("menuitem", { name: copy.delete })).toBeVisible()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  it("closes both dialogs after explicitly deleting its selected fixture and focuses the next card", async () => {
    const fetch = vi.spyOn(window, "fetch")
    render(<PrototypeCanvasThreadSample />)
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${sampleThreads[0]!.body}` }))
    fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
    fireEvent.click(screen.getByRole("menuitem", { name: copy.delete }))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: copy.deleteTitle })).getByRole("button", {
        name: copy.delete,
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: sampleThreads[0]!.target }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole("dialog", { name: copy.deleteTitle })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: copy.point(1) })).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: `Open note: ${sampleThreads[1]!.body}` }),
    ).toHaveFocus()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("filters the list without closing or discarding a selected thread and returns focus when its card is hidden", () => {
    render(<PrototypeCanvasThreadSample />)
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${sampleThreads[0]!.body}` }))
    const dialog = screen.getByRole("dialog", { name: sampleThreads[0]!.target })
    const input = within(dialog).getByRole("textbox", { name: copy.comments.replyLabel })
    fireEvent.change(input, { target: { value: "Keep my draft while filtering" } })
    const marker = screen.getByRole("button", { name: copy.point(1) })
    for (const [filter, count] of [
      [copy.ready, 2],
      [copy.allActive, 3],
      [copy.resolved, 0],
    ] as const) {
      const trigger = screen.getByRole("button", { name: new RegExp(`^${copy.filter}:`) })
      expect(trigger).toBeEnabled()
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole("menuitemradio", { name: filter }))
      expect(screen.queryAllByRole("button", { name: /^Open note:/ })).toHaveLength(count)
      expect(screen.getByRole("dialog", { name: sampleThreads[0]!.target })).toBe(dialog)
      expect(input).toHaveValue("Keep my draft while filtering")
      expect(screen.getByRole("button", { name: copy.point(1) })).toBe(marker)
      expect(marker).toHaveAttribute("aria-expanded", "true")
    }
    fireEvent.click(within(dialog).getByRole("button", { name: copy.back }))
    expect(screen.getByText(copy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: sampleThreads[0]!.target })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: copy.open })).toHaveFocus()
  })

  it("shows readiness and counts only human follow-ups", () => {
    const fetch = vi.spyOn(window, "fetch")
    render(<PrototypeCanvasThreadSample />)
    expect(screen.queryByText(/visual experiment/i)).not.toBeInTheDocument()
    const first = screen.getByRole("button", {
      name: `Open note: ${sampleThreads[0]!.body}`,
    })
    expect(within(first).getByText(copy.ready)).toBeVisible()
    const card = first.closest("article")
    if (!card) throw new Error("Expected the sample card.")
    expect(within(card).queryByText(/follow-up/)).not.toBeInTheDocument()
    const second = screen
      .getByRole("button", { name: `Open note: ${sampleThreads[1]!.body}` })
      .closest("article")
    if (!second) throw new Error("Expected the second card.")
    const followUps = within(second).getByText(copy.followUps(2))
    expect(followUps).toBeVisible()
    expect(followUps.closest("button, a")).toBeNull()
    const open = screen.getByRole("button", {
      name: `Open note: ${sampleThreads[2]!.body}`,
    })
    expect(within(open).queryByText(copy.openStatus)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 2` }))
    expect(screen.queryByRole("menuitem", { name: "Add follow-up" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: copy.markResolved })).toBeEnabled()
    expect(screen.queryByText(/\d+ replies/)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("opens comment presentation with a visible Copilot response and adds isolated open work", async () => {
    const fetch = vi.spyOn(window, "fetch")
    render(<PrototypeCanvasThreadSample />)
    const open = screen.getByRole("button", {
      name: `Open note: ${sampleThreads[0]!.body}`,
    })
    fireEvent.click(open)
    const conversation = screen.getByRole("dialog", { name: sampleThreads[0]!.target })
    expect(screen.getAllByRole("button", { name: /^Open note:/ })).toHaveLength(3)
    expect(conversation.closest("aside")).toBeNull()
    expect(within(conversation).getByText(copy.copilot)).toBeVisible()
    expect(conversation.querySelectorAll(".review-thread-message__body")[1]?.textContent).toBe(
      sampleThreads[0]!.messages[0]!.body,
    )
    const input = within(conversation).getByRole("textbox", { name: copy.comments.replyLabel })
    expect(input).toHaveFocus()
    const body = "Keep the new label.\n<img src=x onerror=alert(1)>"
    fireEvent.change(input, { target: { value: body } })
    fireEvent.click(
      within(conversation).getByRole("button", { name: copy.comments.replySubmitLabel }),
    )
    await waitFor(() => expect(input).toHaveValue(""))
    const messages = conversation.querySelectorAll(".review-thread-message__body")
    expect(messages[2]?.textContent).toBe(body)
    expect(messages[2]?.querySelector("img")).toBeNull()
    expect(within(conversation).getAllByText(copy.copilot)).toHaveLength(1)
    expect(
      within(conversation).queryByRole("button", { name: copy.resolve }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: copy.simulate(2) })).toBeVisible()
    fireEvent.click(within(conversation).getByRole("button", { name: copy.back }))
    const reopened = screen.getByRole("button", {
      name: `Open note: ${sampleThreads[0]!.body}`,
    })
    expect(reopened).toHaveFocus()
    const card = screen
      .getByRole("button", { name: `Open note: ${sampleThreads[0]!.body}` })
      .closest("article")
    if (!card) throw new Error("Expected the sample card.")
    expect(within(card).getByText(copy.followUps(1))).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.simulate(2) }))
    fireEvent.click(reopened)
    expect(screen.getByText(copy.simulatedAnswer)).toBeVisible()
    expect(screen.getByRole("button", { name: copy.resolve })).toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps follow-up composition in the conversation and preserves drafts until discarded", () => {
    render(<PrototypeCanvasThreadSample />)
    fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
    expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: copy.markResolved })).toBeEnabled()
    fireEvent.keyDown(screen.getByRole("menuitem", { name: copy.markResolved }), {
      key: "Escape",
    })
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${sampleThreads[0]!.body}` }))
    const input = screen.getByRole("textbox", { name: copy.comments.replyLabel })
    expect(input).toHaveAttribute("placeholder", "Request a follow-up change")
    fireEvent.change(input, { target: { value: "Unsaved sample request" } })
    fireEvent.click(screen.getByRole("button", { name: copy.back }))
    expect(screen.getByText(copy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.comments.keepLabel }))
    expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
      "Unsaved sample request",
    )
    fireEvent.click(screen.getByRole("button", { name: copy.back }))
    fireEvent.click(screen.getByRole("button", { name: copy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: sampleThreads[0]!.target })).not.toBeInTheDocument()
    expect(screen.queryByText(copy.followUps(1))).not.toBeInTheDocument()
  })

  it("bounds long drafts and restores fixture state on remount without storage", () => {
    const fetch = vi.spyOn(window, "fetch")
    const view = render(<PrototypeCanvasThreadSample />)
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${sampleThreads[0]!.body}` }))
    const input = screen.getByRole("textbox", { name: copy.comments.replyLabel })
    fireEvent.change(input, { target: { value: "x".repeat(10_001) } })
    expect(screen.getByRole("alert")).toHaveTextContent(copy.comments.bodyTooLongLabel)
    expect(screen.getByRole("button", { name: copy.comments.replySubmitLabel })).toBeDisabled()
    view.unmount()
    render(<PrototypeCanvasThreadSample />)
    expect(screen.queryByRole("dialog", { name: sampleThreads[0]!.target })).not.toBeInTheDocument()
    expect(screen.queryByText(copy.followUps(1))).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("resolves through the sidebar menu and keeps filtering and top-only Fix all", async () => {
    const fetch = vi.spyOn(window, "fetch")
    render(<PrototypeCanvasThreadSample />)
    function cards() {
      return screen.queryAllByRole("button", { name: /^Open note:/ })
    }
    function choose(label: string) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${copy.filter}:`) }))
      fireEvent.keyDown(screen.getByRole("menuitemradio", { name: label }), { key: "Enter" })
    }
    expect(cards()).toHaveLength(3)
    const fix = screen.getByRole("button", { name: copy.simulate(1) })
    expect(fix.closest(".thread-sample__filters")).not.toBeNull()
    expect(screen.getAllByRole("button", { name: copy.simulate(1) })).toHaveLength(1)
    choose(copy.ready)
    expect(cards()).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /Fix all/ })).not.toBeInTheDocument()
    choose(copy.resolved)
    expect(cards()).toHaveLength(0)
    expect(screen.getByText(copy.empty)).toBeVisible()
    choose(copy.allActive)
    fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
    fireEvent.click(screen.getByRole("menuitem", { name: copy.markResolved }))
    await waitFor(() => expect(cards()).toHaveLength(2))
    choose(copy.resolved)
    expect(cards()).toHaveLength(1)
    choose(copy.allActive)
    fireEvent.click(screen.getByRole("button", { name: copy.simulate(1) }))
    expect(screen.getByRole("button", { name: copy.simulate(0) })).toBeDisabled()
    choose(copy.ready)
    expect(cards()).toHaveLength(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("opens at explicit sample points, dismisses with Escape and protects drafts", () => {
    render(<PrototypeCanvasThreadSample />)
    const point = screen.getByRole("button", { name: copy.point(1) })
    fireEvent.click(point)
    expect(screen.getByRole("dialog", { name: sampleThreads[0]!.target })).toBeVisible()
    fireEvent.keyDown(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      key: "Escape",
    })
    expect(screen.queryByRole("dialog", { name: sampleThreads[0]!.target })).not.toBeInTheDocument()
    expect(point).toHaveFocus()
    fireEvent.click(point)
    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Keep this draft" },
    })
    fireEvent(window, new Event("replica:review-dismiss"))
    expect(screen.getByText(copy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
      "Keep this draft",
    )
    expect(screen.getByRole("button", { name: copy.point(2) })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: copy.back }))
    fireEvent.click(screen.getByRole("button", { name: copy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: sampleThreads[0]!.target })).not.toBeInTheDocument()
    expect(point).toHaveFocus()
  })
})
