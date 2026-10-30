import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReviewThread } from "@utils/review-comment/types"

import { ReviewCommentMarkers } from "."

const THREAD: ReviewThread = {
  root: {
    id: 1,
    kind: "root",
    buildNumber: 2,
    buildPath: "/repositories/2001/prototypes/1?build=2",
    body: "Keep this group together.",
    anchor: {
      schemaVersion: 1,
      kind: "area",
      route: { pathname: "/", search: "", hash: "" },
      path: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      rect: { x: 20, y: 30, width: 100, height: 60 },
      viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
      elements: [],
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
  replies: [],
  participants: [{ login: "octocat", name: "The Octocat", avatarUrl: null }],
  lastActivityAt: "2026-09-14T12:00:00Z",
  unread: false,
}

describe("ReviewCommentMarkers()", () => {
  it("shows an area highlight only while its thread is selected when requested", () => {
    const resolutions = new Map([
      [
        1,
        {
          commentId: 1,
          status: "resolved" as const,
          rect: { x: 20, y: 30, width: 100, height: 60 },
          point: { x: 120, y: 30 },
        },
      ],
    ])
    const props = {
      threads: [THREAD],
      resolutions,
      selectionBlocked: false,
      focusSelectedMarker: false,
      showAreaHighlightsOnlyWhenSelected: true,
      copy: {
        heading: "Comments",
        markerLabel: "Thread started by %{author}",
        unreadMarkerLabel: "Unread thread started by %{author}",
        markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
        unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
      },
      onSelect: vi.fn(),
    }
    const { container, rerender } = render(
      <ReviewCommentMarkers {...props} selectedThreadId={null} />,
    )

    expect(container.querySelector(".review-comment-area")).not.toBeInTheDocument()

    rerender(<ReviewCommentMarkers {...props} selectedThreadId={1} />)

    expect(container.querySelector(".review-comment-area")).toBeInTheDocument()
  })

  it("redraws a safely moved area and keeps its marker selectable", () => {
    const onSelect = vi.fn()
    const { container } = render(
      <ReviewCommentMarkers
        threads={[THREAD]}
        resolutions={
          new Map([
            [
              1,
              {
                commentId: 1,
                status: "moved" as const,
                rect: { x: 220, y: 130, width: 100, height: 60 },
                point: { x: 320, y: 130 },
              },
            ],
          ])
        }
        selectedThreadId={1}
        selectionBlocked={false}
        copy={{
          heading: "Comments",
          markerLabel: "Thread started by %{author}",
          unreadMarkerLabel: "Unread thread started by %{author}",
          markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
          unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
        }}
        onSelect={onSelect}
      />,
    )

    expect(container.querySelector("polyline")).toHaveAttribute("points", "220,130 320,190")
    const marker = screen.getByRole("button", { name: "Thread started by @octocat" })
    expect(marker).toHaveStyle({ left: "320px", top: "190px" })

    fireEvent.click(marker)

    expect(onSelect).toHaveBeenCalledWith(THREAD)
  })

  it("names unread markers without exposing read state to the preview", () => {
    render(
      <ReviewCommentMarkers
        threads={[{ ...THREAD, unread: true }]}
        resolutions={
          new Map([
            [
              1,
              {
                commentId: 1,
                status: "resolved" as const,
                rect: { x: 20, y: 30, width: 100, height: 60 },
                point: { x: 120, y: 90 },
              },
            ],
          ])
        }
        selectedThreadId={null}
        selectionBlocked={false}
        copy={{
          heading: "Comments",
          markerLabel: "Thread started by %{author}",
          unreadMarkerLabel: "Unread thread started by %{author}",
          markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
          unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
        }}
        onSelect={vi.fn()}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Unread thread started by @octocat" }),
    ).toBeInTheDocument()
  })

  it("counts replies in the pin label and shows an overflow avatar without moving the anchor", () => {
    const thread: ReviewThread = {
      ...THREAD,
      replies: [
        {
          id: 2,
          kind: "reply",
          rootId: 1,
          body: "Agree.",
          createdAt: THREAD.root.createdAt,
          updatedAt: THREAD.root.updatedAt,
          editedAt: null,
          deletedAt: null,
          author: { login: "mona", name: "Mona", avatarUrl: null },
          viewerCanEdit: false,
          viewerCanDelete: false,
          reactions: [],
        },
      ],
      participants: [
        THREAD.root.author,
        { login: "mona", name: "Mona", avatarUrl: null },
        { login: "hubot", name: "Hubot", avatarUrl: null },
        { login: "reviewer", name: "Reviewer", avatarUrl: null },
        { login: "owner", name: "Owner", avatarUrl: null },
      ],
    }
    const { container } = render(
      <ReviewCommentMarkers
        threads={[thread]}
        resolutions={
          new Map([
            [
              1,
              {
                commentId: 1,
                status: "resolved",
                rect: { x: 20, y: 30, width: 100, height: 60 },
                point: { x: 120, y: 90 },
              },
            ],
          ])
        }
        selectedThreadId={null}
        selectionBlocked={false}
        copy={{
          heading: "Comments",
          markerLabel: "Thread started by %{author}",
          unreadMarkerLabel: "Unread thread started by %{author}",
          markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
          unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
        }}
        onSelect={vi.fn()}
      />,
    )
    const marker = screen.getByRole("button", {
      name: "Thread started by @octocat, 2 comments",
    })
    expect(marker).toHaveStyle({ left: "120px", top: "90px" })
    expect(container.querySelector(".review-participant-stack")).toHaveAttribute(
      "data-avatar-count",
      "4",
    )
    expect(container.querySelector(".review-participant-stack")).toHaveAttribute(
      "data-participant-count",
      "5",
    )
    expect(
      container.querySelector(".review-participant-stack__avatar--overflow"),
    ).toHaveTextContent("+2")
    expect(marker).not.toHaveAttribute("title")
    marker.focus()
    expect(marker).toHaveFocus()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(marker.querySelectorAll("button, a, [tabindex]")).toHaveLength(0)
    expect(container.querySelector('[role="tooltip"]')).toHaveTextContent("@reviewer, @owner")
    expect(container.querySelector(".review-participant-stack__avatar img")).toHaveAttribute(
      "src",
      "/avatar-placeholder.svg",
    )
  })

  it("keeps a wide marker inside the right edge as the preview resizes", () => {
    const { container } = render(
      <ReviewCommentMarkers
        threads={[
          {
            ...THREAD,
            participants: [
              THREAD.root.author,
              { login: "mona", name: "Mona", avatarUrl: null },
              { login: "hubot", name: "Hubot", avatarUrl: null },
              { login: "reviewer", name: "Reviewer", avatarUrl: null },
              { login: "owner", name: "Owner", avatarUrl: null },
            ],
          },
        ]}
        resolutions={
          new Map([
            [
              1,
              {
                commentId: 1,
                status: "resolved",
                rect: { x: 80, y: 30, width: 100, height: 60 },
                point: { x: 180, y: 90 },
              },
            ],
          ])
        }
        selectedThreadId={null}
        selectionBlocked={false}
        copy={{
          heading: "Comments",
          markerLabel: "Thread started by %{author}",
          unreadMarkerLabel: "Unread thread started by %{author}",
          markerWithRepliesLabel: "Thread started by %{author}, %{count} comments",
          unreadMarkerWithRepliesLabel: "Unread thread started by %{author}, %{count} comments",
        }}
        onSelect={vi.fn()}
      />,
    )
    const layer = container.querySelector<HTMLElement>(".review-comment-markers")!
    const marker = screen.getByRole("button", { name: "Thread started by @octocat" })
    let previewWidth = 200
    Object.defineProperty(layer, "clientWidth", { get: () => previewWidth })
    Object.defineProperty(marker, "offsetWidth", { value: 100 })

    fireEvent(window, new Event("resize"))
    expect(marker).toHaveStyle({ left: "180px", top: "90px" })
    expect(marker.style.getPropertyValue("--review-marker-offset-x")).toBe("-64px")
    expect(marker.querySelector(".review-participant-stack__avatar--overflow")).toHaveTextContent(
      "+2",
    )

    previewWidth = 400
    fireEvent(window, new Event("resize"))
    expect(marker.style.getPropertyValue("--review-marker-offset-x")).toBe("0px")
    expect(marker).toHaveStyle({ left: "180px", top: "90px" })
  })
})
