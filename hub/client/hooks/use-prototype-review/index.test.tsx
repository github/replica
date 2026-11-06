import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { resolvedAnchor } from "@/storybook/fixtures/review/anchors"
import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import type { PreviewBridgeCommand, PreviewBridgeMessage } from "@utils/preview-bridge/types"

import { usePrototypeReview } from "."

const commentsPath = "/repositories/2001/prototypes/1/review_comments"
const previewUrl = "http://b1.preview.replica.localhost:19500/"
const anchorPoint =
  resolvedAnchor.status === "resolved" || resolvedAnchor.status === "moved"
    ? resolvedAnchor.point
    : null
const elementAnchor = octocatRootComment.anchor
if (elementAnchor.kind !== "element") throw new Error("Expected the element anchor fixture.")
const createdComment = {
  ...octocatRootComment,
  id: 2,
  body: "Please update this heading.",
  anchor: elementAnchor,
}

async function openReview() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation((_input, options) =>
      Promise.resolve(
        Response.json(
          options?.method === "POST"
            ? { comments: [createdComment] }
            : { comments: [octocatRootComment], hasMore: false, nextCursor: null },
        ),
      ),
    )
  vi.stubGlobal("fetch", fetchMock)
  const frame = document.createElement("iframe")
  document.body.append(frame)
  const iframeRef = { current: frame }
  const commands: PreviewBridgeCommand[] = []
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(
    (command: PreviewBridgeCommand) => commands.push(command),
  )
  const { result } = renderHook(() =>
    usePrototypeReview({
      authenticityToken: "csrf-token",
      iframeRef,
      previewTheme: "light",
      prototypeId: 1,
      repositoryId: 2001,
      reviewCommentsPath: commentsPath,
      viewerLogin: "octocat",
      selectedBuild: { number: 1, previewUrl },
    }),
  )
  function receive(message: PreviewBridgeMessage) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: new URL(previewUrl).origin,
          data: message,
        }),
      )
    })
  }
  await waitFor(() => expect(result.current.threads).toHaveLength(1))
  receive({
    type: "replica:bridge:ready",
    protocolVersion: 1,
    requestId: "ready",
    payload: { route: { pathname: "/", search: "", hash: "" } },
  })
  receive({
    type: "replica:bridge:anchors-resolved",
    protocolVersion: 1,
    requestId: "resolved",
    payload: { results: [resolvedAnchor] },
  })
  return { result, commands, receive, fetchMock }
}

describe("usePrototypeReview()", () => {
  it.each([false, true])(
    "opens a targeted thread without changing sidebar open state %s",
    async (sidebarOpen) => {
      const { result, commands } = await openReview()
      if (sidebarOpen) act(() => result.current.toggleSidebar())

      act(() => result.current.selectThread(result.current.threads[0]!))

      expect(result.current.sidebarOpen).toBe(sidebarOpen)
      expect(result.current.selectedThreadId).toBe(octocatRootComment.id)
      expect(result.current.selectedThreadPoint).toEqual(anchorPoint)
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: "replica:bridge:focus-anchor",
          payload: { commentId: octocatRootComment.id },
        }),
      )
      act(() => result.current.closeThread())
      expect(result.current.sidebarOpen).toBe(sidebarOpen)
      expect(result.current.selectedThread).toBeNull()
    },
  )

  it.each([false, true])(
    "preserves sidebar open state %s while targeting and posting a comment",
    async (sidebarOpen) => {
      const { result, commands, receive, fetchMock } = await openReview()
      if (sidebarOpen) act(() => result.current.toggleSidebar())
      act(() => result.current.startElementSelection())
      const selection = commands.findLast(
        (command) => command.type === "replica:bridge:select-element",
      )!
      expect(result.current.sidebarOpen).toBe(sidebarOpen)
      receive({
        type: "replica:bridge:element-selected",
        protocolVersion: 1,
        requestId: selection.requestId,
        payload: { anchor: createdComment.anchor },
      })
      let saved = false
      await act(async () => {
        saved = await result.current.createComment(createdComment.body)
      })

      expect(saved).toBe(true)
      expect(result.current.sidebarOpen).toBe(sidebarOpen)
      expect(result.current.selectedThreadId).toBe(createdComment.id)
      expect(result.current.bridge.selectedAnchor).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith(
        commentsPath,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            review_comment: {
              build_number: 1,
              body: createdComment.body,
              anchor: createdComment.anchor,
            },
          }),
        }),
      )
      receive({
        type: "replica:bridge:anchors-resolved",
        protocolVersion: 1,
        requestId: "created-target",
        payload: { results: [{ ...resolvedAnchor, commentId: createdComment.id }] },
      })
      expect(result.current.selectedThreadPoint).toEqual(anchorPoint)
    },
  )

  it("keeps explicit toggling and protects an unfinished conversation", async () => {
    const { result, commands } = await openReview()
    act(() => result.current.selectThread(result.current.threads[0]!))
    act(() => result.current.setConversationDraftActive(true))
    act(() => {
      result.current.toggleSidebar()
      result.current.selectThread({
        ...result.current.threads[0]!,
        root: createdComment,
      })
      result.current.startAreaSelection()
    })
    expect(result.current.sidebarOpen).toBe(false)
    expect(result.current.selectedThreadId).toBe(octocatRootComment.id)
    expect(commands.some((command) => command.type === "replica:bridge:select-area")).toBe(false)

    act(() => result.current.setConversationDraftActive(false))
    act(() => result.current.toggleSidebar())
    expect(result.current.sidebarOpen).toBe(true)
    expect(result.current.selectedThreadId).toBe(octocatRootComment.id)
    act(() => result.current.toggleSidebar())
    expect(result.current.sidebarOpen).toBe(false)
    expect(result.current.selectedThread).toBeNull()
  })
})
