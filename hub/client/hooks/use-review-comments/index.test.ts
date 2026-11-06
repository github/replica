import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ReviewComment, ReviewRootComment } from "@utils/review-comment/types"

import { useReviewComments } from "."

const REVIEW_COMMENTS_PATH = "/repositories/2001/prototypes/1/review_comments"
const COMMENT_1: ReviewRootComment = {
  id: 1,
  kind: "root",
  buildNumber: 2,
  buildPath: "/repositories/2001/prototypes/1?build=2",
  body: "Comment 1",
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
  createdAt: "2026-09-14T12:00:00.000000Z",
  updatedAt: "2026-09-14T12:00:00.000000Z",
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
}
const COMMENT_2: ReviewRootComment = { ...COMMENT_1, id: 2, body: "Comment 2" }
const CREATED_COMMENT: ReviewRootComment = {
  ...COMMENT_1,
  id: 2,
  body: "Created comment",
}

function deferredResponse() {
  function ignoreResponse() {}

  let resolve: (response: Response) => void = ignoreResponse
  const promise = new Promise<Response>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe("useReviewComments()", () => {
  it("marks a thread unread through its read endpoint and keeps the returned viewer state", async () => {
    const unread = { ...COMMENT_1, viewerLastSeenActivityVersion: null }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_2, COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [unread] }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      expect(await result.current.markThreadUnread(1)).toEqual(unread)
    })

    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${REVIEW_COMMENTS_PATH}/1/read`)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "X-CSRF-Token": "csrf-token" },
    })
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined()
    expect(result.current.comments).toEqual([COMMENT_2, unread])
  })

  it("keeps saved read state after an unread failure and lets the viewer retry", async () => {
    const unread = { ...COMMENT_1, viewerLastSeenActivityVersion: null }
    const message = "Too many requests. Wait before trying again."
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: "rate_limited", errors: [message], retryAfter: 60 }, { status: 429 }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [unread] }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      expect(await result.current.markThreadUnread(1)).toBeNull()
    })
    expect(result.current.comments).toEqual([COMMENT_1])
    expect(result.current.mutationError).toBe(message)
    expect(result.current.mutation).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      expect(await result.current.markThreadUnread(1)).toEqual(unread)
    })
    expect(result.current.comments).toEqual([unread])
    expect(result.current.mutationError).toBeNull()
  })

  it("does not replace a confirmed reaction with an older read acknowledgement", async () => {
    const readResponse = deferredResponse()
    const reacted = {
      ...COMMENT_1,
      reactions: [{ content: "+1" as const, count: 1, viewerHasReacted: true }],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockReturnValueOnce(readResponse.promise)
      .mockResolvedValueOnce(Response.json({ comments: [reacted] }))
      .mockResolvedValueOnce(
        Response.json({ comments: [reacted], nextCursor: null, hasMore: false }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let read: Promise<ReviewComment | null> | undefined
    await act(async () => {
      read = result.current.markThreadRead(1, 1)
      await result.current.addReaction(1, "+1")
    })
    expect(result.current.comments).toEqual([reacted])
    await act(async () => {
      readResponse.resolve(Response.json({ comments: [COMMENT_1] }))
      await read
    })
    expect(result.current.comments).toEqual([reacted])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("rejects a second write while a reaction is saving and resumes after failure", async () => {
    const reactionResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockReturnValueOnce(reactionResponse.promise)
      .mockResolvedValueOnce(Response.json({ comments: [COMMENT_1] }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let reaction: Promise<ReviewComment | null> | undefined
    await act(async () => {
      reaction = result.current.addReaction(1, "+1")
      expect(await result.current.deleteComment(1)).toBeNull()
      expect(await result.current.addReaction(1, "heart")).toBeNull()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.mutation?.kind).toBe("add-reaction")
    await act(async () => {
      reactionResponse.resolve(new Response(null, { status: 500 }))
      expect(await reaction).toBeNull()
    })
    expect(result.current.mutation).toBeNull()
    await act(async () => {
      expect(await result.current.addReaction(1, "heart")).toEqual(COMMENT_1)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("keeps comments and shows retry guidance without automatically retrying a rejected change", async () => {
    const message = "Too many requests. No changes were made. Wait 60 seconds, then try again."
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: "rate_limited", errors: [message], retryAfter: 60 }, { status: 429 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      expect(await result.current.createReply(1, "Keep this draft")).toBeNull()
    })
    expect(result.current.comments).toEqual([COMMENT_1])
    expect(result.current.mutationError).toBe(message)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("loads the complete collection in one request and preserves newest-first order", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_2, COMMENT_1], nextCursor: null, hasMore: false }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))

    await waitFor(() => expect(result.current.comments).toHaveLength(2))
    expect(result.current.comments.map(({ id }) => id)).toEqual([2, 1])
    expect(result.current.loading).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const input = fetchMock.mock.calls[0]?.[0]
    const request = new URL(
      input instanceof Request ? input.url : (input ?? ""),
      window.location.origin,
    )
    expect(request.pathname).toBe(REVIEW_COMMENTS_PATH)
    expect(request.search).toBe("")
  })

  it("adds the created comment without reloading the page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [CREATED_COMMENT] }, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let saved: ReviewComment | null = null
    await act(async () => {
      saved = await result.current.createComment(2, "Created comment", CREATED_COMMENT.anchor)
    })

    expect(saved).toEqual(CREATED_COMMENT)
    expect(result.current.comments.map(({ id }) => id)).toEqual([2, 1])
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: { "X-CSRF-Token": "csrf-token" },
    })
  })

  it("sends reply, edit, delete, resolution, and reopen changes to member routes", async () => {
    const reply: ReviewComment = {
      id: 3,
      kind: "reply",
      rootId: 1,
      body: "Reply",
      createdAt: "2026-09-14T13:00:00Z",
      updatedAt: "2026-09-14T13:00:00Z",
      editedAt: null,
      deletedAt: null,
      author: { login: "mona", name: "Mona Lisa", avatarUrl: null },
      viewerCanEdit: true,
      viewerCanDelete: true,
      reactions: [],
    }
    const edited = { ...reply, body: "Edited", editedAt: "2026-09-14T14:00:00Z" }
    const deleted = {
      ...edited,
      body: null,
      deletedAt: "2026-09-14T15:00:00Z",
      editedAt: null,
      viewerCanEdit: false,
      viewerCanDelete: false,
    }
    const resolved = {
      ...COMMENT_1,
      resolvedAt: "2026-09-14T16:00:00Z",
      resolvedBy: COMMENT_1.author,
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            comments: [
              reply,
              {
                ...COMMENT_1,
                activityVersion: 2,
                viewerLastSeenActivityVersion: 2,
              },
            ],
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ comments: [edited, COMMENT_1] }))
      .mockResolvedValueOnce(Response.json({ comments: [deleted, COMMENT_1] }))
      .mockResolvedValueOnce(Response.json({ comments: [resolved] }))
      .mockResolvedValueOnce(Response.json({ comments: [COMMENT_1] }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createReply(1, "Reply")
      await result.current.editComment(3, "Edited")
      await result.current.deleteComment(3)
      await result.current.resolveThread(1)
      await result.current.reopenThread(1)
    })

    expect(fetchMock.mock.calls.slice(1).map(([request]) => request)).toEqual([
      `${REVIEW_COMMENTS_PATH}/1/replies`,
      `${REVIEW_COMMENTS_PATH}/3`,
      `${REVIEW_COMMENTS_PATH}/3`,
      `${REVIEW_COMMENTS_PATH}/1/resolution`,
      `${REVIEW_COMMENTS_PATH}/1/resolution`,
    ])
    expect(fetchMock.mock.calls.slice(1).map(([, request]) => request?.method)).toEqual([
      "POST",
      "PATCH",
      "DELETE",
      "POST",
      "DELETE",
    ])
    expect(result.current.comments.find(({ id }) => id === 3)).toEqual(deleted)
    expect(result.current.comments.find(({ id }) => id === 1)).toEqual(COMMENT_1)
  })

  it("reports invalid or failed responses without returning success-shaped data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ comments: "invalid" }))
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.loadFailed).toBe(true)
    expect(result.current.comments).toEqual([])
  })

  it("changes reactions and records the exact activity version shown", async () => {
    const unread = { ...COMMENT_1, viewerLastSeenActivityVersion: null }
    const reacted = {
      ...unread,
      viewerLastSeenActivityVersion: 1,
      reactions: [{ content: "+1" as const, count: 1, viewerHasReacted: true }],
    }
    const read = { ...unread, viewerLastSeenActivityVersion: 1 }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [unread], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [reacted] }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ comments: [read] }))
      .mockResolvedValueOnce(Response.json({ comments: [read] }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.addReaction(1, "+1")
      await result.current.removeReaction(1, "+1")
      await result.current.markThreadRead(1, 1)
    })

    expect(fetchMock.mock.calls.slice(1).map(([request]) => request)).toEqual([
      `${REVIEW_COMMENTS_PATH}/1/reactions`,
      `${REVIEW_COMMENTS_PATH}/1/reactions/+1`,
      `${REVIEW_COMMENTS_PATH}/1/read`,
    ])
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        review_comment_reaction: { content: "+1", activity_version: 1 },
      }),
    )
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ review_comment_reaction: { activity_version: 1 } }),
    )
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({ review_thread_read: { activity_version: 1 } }),
    )
    expect(result.current.comments[0]).toEqual(read)
  })

  it("uses the root activity version when reacting to a reply", async () => {
    const root = { ...COMMENT_1, activityVersion: 4 }
    const reply: ReviewComment = {
      id: 3,
      kind: "reply",
      rootId: root.id,
      body: "Reply",
      createdAt: "2026-09-14T13:00:00Z",
      updatedAt: "2026-09-14T13:00:00Z",
      editedAt: null,
      deletedAt: null,
      author: { login: "mona", name: "Mona Lisa", avatarUrl: null },
      viewerCanEdit: false,
      viewerCanDelete: false,
      reactions: [],
    }
    const reactedReply = {
      ...reply,
      reactions: [{ content: "heart" as const, count: 1, viewerHasReacted: true }],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [root, reply], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [reactedReply, root] }, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.addReaction(reply.id, "heart")
    })

    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        review_comment_reaction: { content: "heart", activity_version: root.activityVersion },
      }),
    )
  })

  it("keeps current comments visible during a quiet refresh", async () => {
    const refreshResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockImplementationOnce(() => refreshResponse.promise)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.refreshComments())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.comments).toEqual([COMMENT_1])
    expect(result.current.loading).toBe(false)

    act(() => {
      refreshResponse.resolve(
        Response.json({
          comments: [COMMENT_2, COMMENT_1],
          nextCursor: null,
          hasMore: false,
        }),
      )
    })

    await waitFor(() => expect(result.current.comments).toEqual([COMMENT_2, COMMENT_1]))
  })

  it("quietly refreshes a successfully loaded empty collection", async () => {
    const refreshResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ comments: [], nextCursor: null, hasMore: false }))
      .mockImplementationOnce(() => refreshResponse.promise)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.refreshComments())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.comments).toEqual([])
    expect(result.current.loading).toBe(false)

    act(() => {
      refreshResponse.resolve(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
    })
    await waitFor(() => expect(result.current.comments).toEqual([COMMENT_1]))
  })

  it("uses the same refresh operation to retry an initial failure", async () => {
    const retryResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockImplementationOnce(() => retryResponse.promise)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loadFailed).toBe(true))

    act(() => result.current.refreshComments())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(true)
    expect(result.current.loadFailed).toBe(false)

    act(() => {
      retryResponse.resolve(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
    })
    await waitFor(() => expect(result.current.comments).toEqual([COMMENT_1]))
    expect(result.current.loading).toBe(false)
  })

  it("coalesces refresh bursts and runs one follow-up refresh", async () => {
    const firstRefreshResponse = deferredResponse()
    const secondRefreshResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockImplementationOnce(() => firstRefreshResponse.promise)
      .mockImplementationOnce(() => secondRefreshResponse.promise)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.refreshComments()
      result.current.refreshComments()
      result.current.refreshComments()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    act(() => {
      firstRefreshResponse.resolve(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    act(() => {
      secondRefreshResponse.resolve(
        Response.json({
          comments: [COMMENT_2, COMMENT_1],
          nextCursor: null,
          hasMore: false,
        }),
      )
    })
    await waitFor(() => expect(result.current.comments).toEqual([COMMENT_2, COMMENT_1]))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not let an older refresh overwrite a newer mutation response", async () => {
    const edited = {
      ...COMMENT_1,
      body: "Edited comment",
      activityVersion: 2,
      viewerLastSeenActivityVersion: 2,
    }
    const oldRefreshResponse = deferredResponse()
    const canonicalRefreshResponse = deferredResponse()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockImplementationOnce(() => oldRefreshResponse.promise)
      .mockResolvedValueOnce(Response.json({ comments: [edited] }))
      .mockImplementationOnce(() => canonicalRefreshResponse.promise)
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.refreshComments())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await act(async () => {
      await result.current.editComment(1, "Edited comment")
    })
    expect(result.current.comments[0]).toEqual(edited)

    act(() => {
      oldRefreshResponse.resolve(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(result.current.comments[0]).toEqual(edited)

    act(() => {
      canonicalRefreshResponse.resolve(
        Response.json({ comments: [edited], nextCursor: null, hasMore: false }),
      )
    })
    await waitFor(() => expect(result.current.comments[0]).toEqual(edited))
  })

  it("uses the current root activity version for reactions", async () => {
    const fullyLoaded = {
      ...COMMENT_1,
      activityVersion: 2,
      viewerLastSeenActivityVersion: 1,
    }
    const edited = {
      ...fullyLoaded,
      body: "Edited comment",
      activityVersion: 3,
      viewerLastSeenActivityVersion: 3,
    }
    const reacted = {
      ...edited,
      reactions: [{ content: "heart" as const, count: 1, viewerHasReacted: true }],
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [fullyLoaded], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(Response.json({ comments: [edited] }))
      .mockResolvedValueOnce(Response.json({ comments: [reacted] }, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.editComment(1, "Edited comment")
    })
    await waitFor(() => expect(result.current.comments[0]).toEqual(edited))

    await act(async () => {
      await result.current.addReaction(1, "heart")
    })

    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        review_comment_reaction: { content: "heart", activity_version: 3 },
      }),
    )
  })

  it.each([404, 503])(
    "clears protected comments when canonical access returns %i",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
        )
        .mockResolvedValueOnce(new Response(null, { status }))
      vi.stubGlobal("fetch", fetchMock)
      const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => result.current.refreshComments())

      await waitFor(() => expect(result.current.loadFailed).toBe(true))
      expect(result.current.comments).toEqual([])
    },
  )

  it("checks canonical access again after a mutation loses its review target", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      expect(await result.current.editComment(1, "Unavailable edit")).toBeNull()
    })

    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.comments).toEqual([])
  })

  it("keeps comments available when a background refresh fails outside authorization", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ comments: [COMMENT_1], nextCursor: null, hasMore: false }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useReviewComments(REVIEW_COMMENTS_PATH, "csrf-token"))
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.refreshComments())

    await waitFor(() => expect(result.current.loadFailed).toBe(true))
    expect(result.current.comments).toEqual([COMMENT_1])
  })
})
