import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { movedAnchor, resolvedAnchor } from "@/storybook/fixtures/review/anchors"
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

async function openReview({
  reviewReadOnly,
  selectedThreadId,
  deferResolution = false,
}: {
  reviewReadOnly?: boolean
  selectedThreadId?: number
  deferResolution?: boolean
} = {}) {
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
  onTestFinished(() => frame.remove())
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
      prototypeId: "1",
      repositoryId: "2001",
      reviewCommentsPath: commentsPath,
      reviewReadOnly,
      selectedThreadId,
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
  if (!deferResolution) {
    receive({
      type: "replica:bridge:anchors-resolved",
      protocolVersion: 1,
      requestId: "resolved",
      payload: { results: [resolvedAnchor] },
    })
  }
  return { result, commands, receive, fetchMock }
}

describe("usePrototypeReview()", () => {
  it("opens existing comments by shortcut in read-only review and protects an active draft", async () => {
    const { result, commands, receive } = await openReview({ reviewReadOnly: true })
    function hostShortcut() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "C", shiftKey: true }))
      })
    }
    function frameShortcut() {
      receive({
        type: "replica:bridge:sidebar-toggle-requested",
        protocolVersion: 1,
        requestId: "shortcut",
        payload: {},
      })
    }

    hostShortcut()
    expect(result.current.sidebarOpen).toBe(true)
    hostShortcut()
    expect(result.current.sidebarOpen).toBe(false)
    frameShortcut()
    expect(result.current.sidebarOpen).toBe(true)

    act(() => {
      result.current.startElementSelection()
      result.current.startAreaSelection()
      result.current.setConversationDraftActive(true)
    })
    expect(result.current.bridge.selecting).toBe(false)
    expect(commands.map(({ type }) => type)).not.toContain("replica:bridge:select-element")
    expect(commands.map(({ type }) => type)).not.toContain("replica:bridge:select-area")
    hostShortcut()
    expect(result.current.sidebarOpen).toBe(true)
    frameShortcut()
    expect(result.current.sidebarOpen).toBe(true)
  })

  it.each([resolvedAnchor, movedAnchor])(
    "defers deep-link focus until the anchor is $status and refocuses when selected again",
    async (resolution) => {
      const { result, commands, receive } = await openReview({
        selectedThreadId: octocatRootComment.id,
        deferResolution: true,
      })
      function focusCommands() {
        return commands.filter(({ type }) => type === "replica:bridge:focus-anchor")
      }
      expect(result.current.selectedThreadId).toBe(octocatRootComment.id)
      expect(focusCommands()).toHaveLength(0)

      receive({
        type: "replica:bridge:anchors-resolved",
        protocolVersion: 1,
        requestId: "resolved",
        payload: { results: [resolution] },
      })
      expect(focusCommands().map(({ payload }) => payload)).toEqual([
        { commentId: octocatRootComment.id },
      ])

      act(() => result.current.selectThread(result.current.selectedThread!))
      expect(focusCommands().map(({ payload }) => payload)).toEqual([
        { commentId: octocatRootComment.id },
        { commentId: octocatRootComment.id },
      ])
    },
  )

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
