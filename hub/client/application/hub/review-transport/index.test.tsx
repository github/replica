import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, vi } from "vitest"

import { useReviewComments } from "@hooks/use-review-comments"
import type { ReviewComment } from "@utils/review-comment/types"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { renderHubFlow } from "../routes/test-fixture"

import { createReviewTransport } from "."

describe("createReviewTransport()", () => {
  it.each([403, 503])(
    "removes previously loaded comments when a mutation loses review access with HTTP %i",
    async (status) => {
      vi.stubEnv("MODE", "development")
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
    vi.stubEnv("MODE", "development")
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

  it.each([422, 500])(
    "keeps the conversation and reply draft available after an ordinary HTTP %i failure",
    async (status) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))
      const router = await renderHubFlow(
        server,
        "/repositories/2001/prototypes/1?build=3&comment=1",
      )
      const conversation = await screen.findByRole("dialog", { name: "Conversation" })
      const savedReply = within(conversation).getByText("I will try a shorter heading.")
      const reply = within(conversation).getByRole("textbox", { name: "Reply" })
      fireEvent.change(reply, { target: { value: "Keep this unsaved review draft." } })
      const rejectReply = vi.fn(() =>
        HttpResponse.json({ error: "The reply could not be saved." }, { status }),
      )
      server.use(
        http.post(
          `${store.origin}/api/repositories/2001/prototypes/1/review-comments/1/replies`,
          rejectReply,
        ),
      )

      await router.settle(() =>
        fireEvent.click(within(conversation).getByRole("button", { name: "Reply" })),
      )

      expect(rejectReply).toHaveBeenCalledOnce()
      expect(within(conversation).getByRole("alert")).toBeVisible()
      expect(savedReply).toBeVisible()
      expect(reply).toHaveValue("Keep this unsaved review draft.")
      expect(within(conversation).getByRole("button", { name: "Reply" })).toBeEnabled()

      server.resetHandlers()
      await router.settle(() =>
        fireEvent.click(within(conversation).getByRole("button", { name: "Reply" })),
      )

      expect(within(conversation).getByText("Keep this unsaved review draft.")).toBeVisible()
      expect(reply).toHaveValue("")
      expect(within(conversation).queryByRole("alert")).not.toBeInTheDocument()
    },
    15_000,
  )
})
