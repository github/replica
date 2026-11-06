import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReviewThread } from "@utils/review-comment/types"

import { ReviewCommentRow } from "."

const THREAD: ReviewThread = {
  root: {
    id: 1,
    kind: "root",
    buildNumber: 2,
    buildPath: "/repositories/2001/prototypes/1?build=2",
    body: "Please align this control.",
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
  replies: [
    {
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
      reactions: [],
    },
  ],
  participants: [
    { login: "octocat", name: "The Octocat", avatarUrl: null },
    { login: "mona", name: "Mona Lisa", avatarUrl: null },
  ],
  lastActivityAt: "2026-09-14T13:00:00Z",
  unread: false,
}

const COPY = {
  buildLabel: "build %{number}",
  changedAnchorLabel: "Context changed",
  deletedCommentLabel: "Comment deleted",
  missingAnchorLabel: "Not found",
  movedAnchorLabel: "Moved",
  replyCountOneLabel: "1 reply",
  replyCountOtherLabel: "%{count} replies",
  resolvedLabel: "Resolved",
  routeMismatchLabel: "Saved on another page",
  selectionBlockedLabel: "Close or submit the open draft.",
  unreadLabel: "Unread",
}

describe("ReviewCommentRow()", () => {
  it("shows no target status until the preview returns a result", () => {
    const props = {
      thread: THREAD,
      currentBuildNumber: 2,
      selected: false,
      selectionBlocked: false,
      copy: COPY,
      onSelect: vi.fn(),
    }
    const { rerender } = render(<ReviewCommentRow {...props} />)

    expect(screen.queryByText("Checking")).not.toBeInTheDocument()
    expect(screen.queryByText("Not found")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Please align this control/ })).toBeEnabled()

    rerender(<ReviewCommentRow {...props} resolution={{ commentId: 1, status: "missing" }} />)
    expect(screen.getByText("Not found")).toBeInTheDocument()
  })

  it("uses a circular Brand avatar for both known and missing images", () => {
    const props = {
      currentBuildNumber: 2,
      selected: true,
      selectionBlocked: false,
      copy: COPY,
      onSelect: vi.fn(),
    }
    const { rerender } = render(
      <ReviewCommentRow
        {...props}
        thread={{
          ...THREAD,
          root: {
            ...THREAD.root,
            author: {
              ...THREAD.root.author,
              avatarUrl: "https://avatars.example.test/octocat",
            },
          },
        }}
      />,
    )

    const avatar = screen.getByTestId("Avatar")
    expect(avatar.className).toContain("Avatar--shape-circle")
    expect(avatar).toHaveClass("hub-user-avatar--20")
    expect(avatar).toHaveClass("review-comment-row__avatar")
    expect(screen.getByTestId("Avatar__image")).toHaveAttribute("alt", "")

    rerender(<ReviewCommentRow {...props} thread={THREAD} />)
    expect(screen.getByTestId("Avatar__image")).toHaveAttribute("src", "/avatar-placeholder.svg")
  })

  it("shows reply counts without requiring Build or anchor context", () => {
    render(
      <ReviewCommentRow
        thread={THREAD}
        currentBuildNumber={2}
        resolution={{
          commentId: 1,
          status: "resolved",
          rect: { x: 20, y: 30, width: 100, height: 32 },
          point: { x: 70, y: 46 },
        }}
        selected={false}
        selectionBlocked={false}
        copy={COPY}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText("1 reply")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "build 2" })).not.toBeInTheDocument()
    expect(screen.queryByText("Checking")).not.toBeInTheDocument()
  })

  it("shows canvas marker status without hiding a resolved conversation", () => {
    const props = {
      currentBuildNumber: 2,
      selected: false,
      selectionBlocked: false,
      copy: COPY,
      onSelect: vi.fn(),
    }
    const { rerender } = render(
      <ReviewCommentRow {...props} thread={THREAD} anchorStatusLabel="Marker unavailable" />,
    )
    expect(screen.getByText("Marker unavailable")).toBeInTheDocument()
    expect(screen.queryByText("Checking")).not.toBeInTheDocument()

    rerender(<ReviewCommentRow {...props} thread={THREAD} anchorStatusLabel={null} />)
    expect(screen.queryByText("Marker unavailable")).not.toBeInTheDocument()

    rerender(
      <ReviewCommentRow
        {...props}
        thread={{
          ...THREAD,
          root: { ...THREAD.root, resolvedAt: "2026-09-14T16:00:00Z" },
        }}
        anchorStatusLabel="Marker unavailable"
      />,
    )
    expect(screen.getByText("Resolved")).toBeInTheDocument()
    expect(screen.queryByText("Marker unavailable")).not.toBeInTheDocument()
  })

  it("announces unread state when focusing the row button", () => {
    const props = {
      currentBuildNumber: 2,
      selected: false,
      selectionBlocked: false,
      copy: COPY,
      onSelect: vi.fn(),
    }
    const { rerender } = render(
      <ReviewCommentRow {...props} thread={{ ...THREAD, unread: true }} />,
    )

    expect(screen.getByRole("img", { name: "Unread" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /The Octocat.*Please align.*Unread/ })).toBeEnabled()

    rerender(<ReviewCommentRow {...props} thread={THREAD} />)
    expect(screen.getByRole("button", { name: /The Octocat.*Please align/ })).toBeEnabled()
    expect(screen.queryByRole("button", { name: /Unread/ })).not.toBeInTheDocument()
  })

  it.each([
    { selected: false, selectionBlocked: false, selectable: true },
    { selected: false, selectionBlocked: true, selectable: false },
    { selected: true, selectionBlocked: true, selectable: true },
  ])(
    "preserves selection from the timestamp and unread dot with selected=$selected and blocked=$selectionBlocked",
    ({ selected, selectionBlocked, selectable }) => {
      const onSelect = vi.fn()
      const thread = { ...THREAD, unread: true }
      render(
        <ReviewCommentRow
          thread={thread}
          currentBuildNumber={2}
          selected={selected}
          selectionBlocked={selectionBlocked}
          copy={COPY}
          onSelect={onSelect}
        />,
      )

      const time = screen.getByTitle("Mon, 14 Sep 2026 13:00:00 GMT")
      const unread = screen.getByRole("img", { name: "Unread" })
      expect(unread).toHaveAttribute("title", "Unread")
      for (const target of [time, unread, screen.getByRole("button")]) fireEvent.click(target)

      expect(onSelect).toHaveBeenCalledTimes(selectable ? 3 : 0)
      if (selectable) expect(onSelect).toHaveBeenLastCalledWith(thread)
    },
  )

  it("opens an overridden Build link without replacing the canvas", () => {
    const onSelect = vi.fn()
    render(
      <ReviewCommentRow
        thread={THREAD}
        currentBuildNumber={3}
        buildHref="https://hub.example.com/repositories/2001/prototypes/1?build=2"
        selected={false}
        selectionBlocked={false}
        copy={COPY}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole("link", { name: "build 2" })).toHaveAttribute("target", "_blank")
    expect(screen.getByRole("link", { name: "build 2" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    )
    const buildLink = screen.getByRole("link", { name: "build 2" })
    expect(buildLink).toHaveAttribute(
      "href",
      "https://hub.example.com/repositories/2001/prototypes/1?build=2",
    )
    expect(buildLink.parentElement).toHaveTextContent("(build 2)")
    expect(screen.getByText("The Octocat").parentElement).toContainElement(buildLink)
    expect(buildLink.closest("button")).toBeNull()
    fireEvent.click(buildLink)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Please align this control/ }))
    expect(onSelect).toHaveBeenCalledWith(THREAD)
  })
})
