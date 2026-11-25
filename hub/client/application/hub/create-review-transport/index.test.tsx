import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useReviewComments } from "@hooks/use-review-comments"
import type { ReviewComment } from "@utils/review-comment/types"

import { createReviewTransport } from "./"

describe("createReviewTransport()", () => {
  it.each([403, 503])(
    "removes previously loaded comments when a mutation loses review access with HTTP %i",
    async (status) => {
      const path = "/api/repositories/2001/prototypes/1/review-comments"
      const comment: ReviewComment = {
        id: 2,
        kind: "reply",
        rootId: 1,
        body: "A previously accessible synthetic reply.",
        createdAt: "2026-10-01T12:00:00Z",
        updatedAt: "2026-10-01T12:00:00Z",
        editedAt: null,
        deletedAt: null,
        author: { login: "octocat", name: "The Octocat", avatarUrl: null },
        viewerCanEdit: true,
        viewerCanDelete: true,
        reactions: [],
      }
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ comments: [comment], nextCursor: null, hasMore: false }),
        )
        .mockImplementation(() =>
          Promise.resolve(
            Response.json({ error: "Review access is no longer available." }, { status }),
          ),
        )
      vi.stubGlobal("fetch", fetchMock)
      const transport = createReviewTransport(window.location.href)
      const { result } = renderHook(() => useReviewComments(path, "", transport))
      await waitFor(() => expect(result.current.comments).toEqual([comment]))
      expect(result.current.loadFailed).toBe(false)

      await act(async () => {
        expect(await result.current.createReply(1, "An unsaved reply.")).toBeNull()
      })

      expect(fetchMock).toHaveBeenCalledWith(
        new URL(`${path}/1/replies`, window.location.href),
        expect.objectContaining({ method: "POST" }),
      )
      await waitFor(() => expect(result.current.comments).toEqual([]))
      expect(result.current.loading).toBe(false)
      expect(result.current.loadFailed).toBe(true)
    },
  )

  it("clears a loaded collection when refreshing review access returns HTTP 503", async () => {
    const path = "/api/repositories/2001/prototypes/1/review-comments"
    const comment: ReviewComment = {
      id: 2,
      kind: "reply",
      rootId: 1,
      body: "A synthetic reply that must not survive access loss.",
      createdAt: "2026-10-01T12:00:00Z",
      updatedAt: "2026-10-01T12:00:00Z",
      editedAt: null,
      deletedAt: null,
      author: { login: "octocat", name: "The Octocat", avatarUrl: null },
      viewerCanEdit: true,
      viewerCanDelete: true,
      reactions: [],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [comment], nextCursor: null, hasMore: false }),
      )
      .mockImplementation(() =>
        Promise.resolve(Response.json({ error: "Review access is unavailable." }, { status: 503 })),
      )
    vi.stubGlobal("fetch", fetchMock)
    const transport = createReviewTransport(window.location.href)
    const { result } = renderHook(() => useReviewComments(path, "", transport))
    await waitFor(() => expect(result.current.comments).toEqual([comment]))

    act(() => result.current.refreshComments())

    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    expect(result.current.comments).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
