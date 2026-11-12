import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ReviewReply } from "@utils/review-comment/types"

import { ReviewCommentReactions } from "."

const COMMENT: ReviewReply = {
  id: 2,
  kind: "reply",
  rootId: 1,
  body: "Updated.",
  createdAt: "2026-09-14T13:00:00Z",
  updatedAt: "2026-09-14T13:00:00Z",
  editedAt: null,
  deletedAt: null,
  author: { login: "mona", name: "Mona Lisa", avatarUrl: null },
  viewerCanEdit: false,
  viewerCanDelete: false,
  reactions: [{ content: "heart", count: 2, viewerHasReacted: true }],
}

const COPY = {
  addReactionLabel: "Add reaction",
  reactionCountOneLabel: "%{reaction}, 1 reaction",
  reactionCountOtherLabel: "%{reaction}, %{count} reactions",
  reactionErrorLabel: "The reaction could not be changed.",
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

describe("ReviewCommentReactions()", () => {
  it("shows an add immediately without replacing the picker and rolls back a rejected request", async () => {
    let rejectAdd: ((error: Error) => void) | undefined
    const onAdd = vi.fn(
      () =>
        new Promise<boolean>((_resolve, reject) => {
          rejectAdd = reject
        }),
    )
    const onBurst = vi.fn()
    const props = {
      comment: { ...COMMENT, reactions: [] },
      mutation: null,
      actionsDisabled: false,
      copy: COPY,
      onAdd,
      onRemove: vi.fn(),
      onBurst,
    }
    const view = render(<ReviewCommentReactions {...props} />)
    const picker = screen.getByRole("button", { name: "Add reaction" })
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
    const added = screen.getByRole("button", { name: "Thumbs up, 1 reaction" })
    expect(added).toHaveAttribute("aria-pressed", "true")
    expect(added).toBeEnabled()
    expect(added).toHaveAttribute("aria-busy", "true")
    expect(onBurst).toHaveBeenCalledOnce()
    fireEvent.click(added)
    expect(onAdd).toHaveBeenCalledOnce()
    expect(props.onRemove).not.toHaveBeenCalled()
    expect(onBurst).toHaveBeenCalledOnce()
    view.rerender(
      <ReviewCommentReactions
        {...props}
        mutation={{ kind: "add-reaction", commentId: COMMENT.id, content: "+1" }}
      />,
    )
    expect(screen.getByRole("button", { name: "Add reaction" })).toBe(picker)
    expect(picker).toBeEnabled()
    fireEvent.click(added)
    expect(onAdd).toHaveBeenCalledOnce()
    expect(props.onRemove).not.toHaveBeenCalled()
    await act(async () => {
      rejectAdd?.(new Error("Offline"))
      await Promise.resolve()
    })
    expect(screen.queryByRole("button", { name: "Thumbs up, 1 reaction" })).not.toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel)
    expect(onBurst).toHaveBeenCalledOnce()
  })

  it("rebases a pending removal on fresh counts and preserves them on rollback", async () => {
    let finishRemove: ((saved: boolean) => void) | undefined
    const onRemove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRemove = resolve
        }),
    )
    const props = {
      comment: COMMENT,
      mutation: null,
      actionsDisabled: false,
      copy: COPY,
      onAdd: vi.fn(),
      onRemove,
      onBurst: vi.fn(),
    }
    const view = render(<ReviewCommentReactions {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Heart, 2 reactions" }))
    expect(screen.getByRole("button", { name: "Heart, 1 reaction" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    view.rerender(
      <ReviewCommentReactions
        {...props}
        comment={{
          ...COMMENT,
          reactions: [{ content: "heart", count: 3, viewerHasReacted: true }],
        }}
      />,
    )
    expect(screen.getByRole("button", { name: "Heart, 2 reactions" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await act(async () => {
      finishRemove?.(false)
      await Promise.resolve()
    })
    expect(screen.getByRole("button", { name: "Heart, 3 reactions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel)
    expect(props.onBurst).not.toHaveBeenCalled()
  })

  it("removes the last reaction immediately and keeps the server-confirmed removal", async () => {
    let finishRemove: ((saved: boolean) => void) | undefined
    const props = {
      comment: {
        ...COMMENT,
        reactions: [{ content: "heart" as const, count: 1, viewerHasReacted: true }],
      },
      mutation: null,
      actionsDisabled: false,
      copy: COPY,
      onAdd: vi.fn(),
      onRemove: () =>
        new Promise<boolean>((resolve) => {
          finishRemove = resolve
        }),
      onBurst: vi.fn(),
    }
    const view = render(<ReviewCommentReactions {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Heart, 1 reaction" }))
    expect(screen.queryByRole("button", { name: /Heart,/ })).not.toBeInTheDocument()
    await act(async () => {
      view.rerender(<ReviewCommentReactions {...props} comment={{ ...COMMENT, reactions: [] }} />)
      finishRemove?.(true)
      await Promise.resolve()
    })
    expect(screen.queryByRole("button", { name: /Heart,/ })).not.toBeInTheDocument()
    expect(props.onBurst).not.toHaveBeenCalled()
  })

  it("removes an existing reaction and offers the fixed reaction set", async () => {
    const onAdd = vi.fn(() => Promise.resolve(true))
    const onRemove = vi.fn(() => Promise.resolve(true))
    const onBurst = vi.fn()
    render(
      <ReviewCommentReactions
        comment={COMMENT}
        mutation={null}
        actionsDisabled={false}
        copy={COPY}
        onAdd={onAdd}
        onRemove={onRemove}
        onBurst={onBurst}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Heart, 2 reactions" }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("heart"))
    expect(onBurst).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    expect(screen.getByRole("menu").className).toContain("ActionMenu__menu")
    expect(screen.getAllByRole("menuitem")).toHaveLength(8)
    fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("+1"))
    expect(onBurst).toHaveBeenCalledWith("👍", expect.any(Number), expect.any(Number))
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Thumbs down/ }), { key: "Enter" })
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("-1"))
  })

  it("describes the disabled reaction menu without making it focusable", () => {
    render(
      <ReviewCommentReactions
        comment={COMMENT}
        mutation={null}
        actionsDisabled
        copy={COPY}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onBurst={vi.fn()}
      />,
    )
    const trigger = screen.getByRole("button", { name: COPY.addReactionLabel })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAccessibleDescription(COPY.addReactionLabel)
    expect(trigger.closest("[title]")).toHaveAttribute("title", COPY.addReactionLabel)
  })

  it("bursts immediately for an add that later fails without replaying the burst", async () => {
    const onBurst = vi.fn()
    render(
      <ReviewCommentReactions
        comment={{ ...COMMENT, reactions: [] }}
        mutation={null}
        actionsDisabled={false}
        copy={COPY}
        onAdd={vi.fn(() => Promise.resolve(false))}
        onRemove={vi.fn(() => Promise.resolve(true))}
        onBurst={onBurst}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
    expect(onBurst).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(COPY.reactionErrorLabel),
    )
    expect(onBurst).toHaveBeenCalledOnce()
  })

  it("bursts at the click point while the add is pending and not again on success", async () => {
    let finishAdd: ((saved: boolean) => void) | undefined
    const onAdd = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishAdd = resolve
        }),
    )
    const onBurst = vi.fn()
    render(
      <ReviewCommentReactions
        comment={{
          ...COMMENT,
          reactions: [{ content: "heart", count: 2, viewerHasReacted: false }],
        }}
        mutation={null}
        actionsDisabled={false}
        copy={COPY}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onBurst={onBurst}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Heart, 2 reactions" }), {
      clientX: 40,
      clientY: 64,
    })
    expect(onBurst).toHaveBeenCalledWith("❤️", 40, 64)
    expect(onBurst).toHaveBeenCalledOnce()
    await act(async () => {
      finishAdd?.(true)
      await Promise.resolve()
    })
    expect(onBurst).toHaveBeenCalledOnce()
  })

  it("does not burst or dispatch an add during a conflicting mutation", () => {
    const onAdd = vi.fn()
    const onBurst = vi.fn()
    render(
      <ReviewCommentReactions
        comment={{ ...COMMENT, reactions: [] }}
        mutation={{ kind: "remove-reaction", commentId: COMMENT.id, content: "heart" }}
        actionsDisabled={false}
        copy={COPY}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onBurst={onBurst}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(onBurst).not.toHaveBeenCalled()
  })

  it.each(["pointer", "keyboard"])(
    "keeps the picker and its description focused without reopening the tooltip after %s selection",
    async (input) => {
      const onBurst = vi.fn()
      render(
        <ReviewCommentReactions
          comment={{ ...COMMENT, reactions: [] }}
          mutation={null}
          actionsDisabled={false}
          copy={COPY}
          onAdd={vi.fn(() => Promise.resolve(true))}
          onRemove={vi.fn()}
          onBurst={onBurst}
        />,
      )
      const picker = screen.getByRole("button", { name: "Add reaction" })
      act(() => picker.focus())
      expect(picker).toHaveAccessibleDescription(COPY.addReactionLabel)
      fireEvent.click(picker)
      const item = screen.getByRole("menuitem", { name: /Thumbs up/ })
      await waitFor(() => expect(item).toHaveFocus())
      item.getBoundingClientRect = () => ({ left: 20, top: 30, width: 40, height: 20 }) as DOMRect
      if (input === "keyboard") {
        fireEvent.keyDown(item, { key: "Enter" })
      } else {
        fireEvent.click(item)
      }
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
      await waitFor(() => expect(picker).toHaveFocus())
      expect(screen.getByRole("button", { name: "Add reaction" })).toBe(picker)
      expect(picker).toHaveAccessibleDescription(COPY.addReactionLabel)
      const tooltip = document.getElementById(picker.getAttribute("aria-describedby")!)
      expect(tooltip).toHaveClass("review-comment-reactions__tooltip--suppressed")
      expect(onBurst).toHaveBeenCalledWith("👍", 40, 40)
      expect(onBurst).toHaveBeenCalledOnce()

      fireEvent.mouseEnter(picker.parentElement!)
      expect(tooltip).not.toHaveClass("review-comment-reactions__tooltip--suppressed")
      fireEvent.click(picker)
      await waitFor(() => expect(screen.getByRole("menuitem", { name: /Thumbs up/ })).toHaveFocus())
      fireEvent.keyDown(screen.getByRole("menuitem", { name: /Thumbs up/ }), { key: "Escape" })
      await waitFor(() => expect(picker).toHaveFocus())
      expect(tooltip).toHaveClass("review-comment-reactions__tooltip--suppressed")
      act(() => picker.blur())
      act(() => picker.focus())
      expect(tooltip).not.toHaveClass("review-comment-reactions__tooltip--suppressed")
      expect(picker).toHaveAccessibleDescription(COPY.addReactionLabel)
    },
  )
})
