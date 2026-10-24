import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { copy as notesCopy } from "@features/prototype-canvas-improvement-notes/en"
import type { Note } from "@features/prototype-canvas-improvement-notes/types"
import { copy as threadsCopy } from "@features/prototype-canvas-improvement-threads/en"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { reviewCommentsCopy as commentsCopy } from "@utils/review-comment/en"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"

import { App } from ".."
import { sharingFixture } from "./sharing-fixture"

function reviewFixture() {
  const { fetch } = sharingFixture(undefined, {
    ...publicationHub,
    state: "connected",
    repositoryAuthorized: true,
    viewerLogin: "octocat",
    prototype: importedPrototype,
  })
  const original = fetch.getMockImplementation()!
  const comment = structuredClone(octocatRootComment)
  comment.anchor = REVIEW_ANCHOR_SCHEMA.parse({ ...comment.anchor, selector: "#comment-target" })
  const note: Note = {
    id: comment.id,
    localId: "saved-note",
    kind: "improvement_note",
    author: "local",
    body: "Make the primary action clearer.",
    route: "/",
    target: "Save",
    selector: "#note-target",
    rect: comment.anchor.rect,
    anchor: REVIEW_ANCHOR_SCHEMA.parse({ ...comment.anchor, selector: "#note-target" }),
    thread: { originalStatus: "open", messages: [] },
    status: "open",
    sync: "local",
    revision: 1,
  }
  const saved = {
    identity: "review-notes",
    revision: 1,
    notes: [note],
    syncError: null,
    activeBatch: null,
  }
  fetch.mockImplementation(async (path, options) => {
    if (path === "/api/hub/comments")
      return Response.json({ comments: [comment], hasMore: false, nextCursor: null })
    if (path === "/api/improvement-notes/capture")
      return Response.json({ identity: saved.identity, sourceId: "selected-source" })
    if (path === "/api/improvement-notes" || path === "/api/improvement-notes/sync")
      return Response.json(saved)
    return original(path, options)
  })
  return { fetch, comment, note, saved }
}

function previewBridge() {
  const element = screen.getByTitle("Demo prototype")
  if (!(element instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
  const frame: HTMLIFrameElement = element
  Object.defineProperties(frame, {
    clientWidth: { configurable: true, value: 960 },
    clientHeight: { configurable: true, value: 560 },
  })
  const post = vi.spyOn(frame.contentWindow!, "postMessage")
  const messageSchema = z.object({
    type: z.string(),
    nonce: z.string(),
    mode: z.string().optional(),
    anchors: z.array(z.object({ id: z.number(), anchor: REVIEW_ANCHOR_SCHEMA })).optional(),
  })
  function messages() {
    return post.mock.calls.flatMap(([data]) => {
      const parsed = messageSchema.safeParse(data)
      return parsed.success ? [parsed.data] : []
    })
  }
  function receive(nonce: string, data: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: new URL(frame.src).origin,
          data: { nonce, ...data },
        }),
      )
    })
  }
  function ready() {
    for (const data of messages()) {
      if (data.type === "replica:canvas:request-ready")
        receive(data.nonce, {
          type: "replica:canvas:ready",
          protocolVersion: 1,
          improvementSelection: true,
          route: { pathname: "/", search: "", hash: "" },
        })
    }
  }
  function resolveNonce(selector: string) {
    const request = messages()
      .reverse()
      .find(
        (data) =>
          data.type === "replica:canvas:resolve" &&
          data.anchors?.some(
            ({ anchor }) => anchor.kind === "element" && anchor.selector === selector,
          ),
      )
    if (!request) throw new Error(`Expected an anchor resolution request for ${selector}.`)
    return String(request.nonce)
  }
  function resolve(nonce: string) {
    receive(nonce, {
      type: "replica:canvas:resolved",
      protocolVersion: 1,
      route: { pathname: "/", search: "", hash: "" },
      results: [{ id: 1, x: 180, y: 180, rect: { x: 120, y: 160, width: 120, height: 40 } }],
    })
  }
  fireEvent.load(frame)
  ready()
  return { post, messages, ready, receive, resolve, resolveNonce }
}

describe("App()", () => {
  it("keeps both review surfaces available and resolves only the active surface's saved pins", async () => {
    const { fetch, note, saved } = reviewFixture()
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: "http://localhost:4321/",
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const comments = await screen.findByRole("button", { name: /^Comments, 1/ })
    const improvements = await screen.findByRole("button", { name: notesCopy.openNotes(1) })
    expect(screen.getByRole("button", { name: commentsCopy.commentMenuLabel })).toBeVisible()
    expect(screen.getByRole("button", { name: notesCopy.annotate })).toBeVisible()
    const bridge = previewBridge()
    fireEvent.click(improvements)
    bridge.ready()
    expect(await screen.findByRole("complementary", { name: notesCopy.notes })).toBeVisible()
    expect(screen.getByRole("button", { name: `Open improvement: ${note.body}` })).toBeVisible()
    const noteNonce = bridge.resolveNonce("#note-target")
    bridge.resolve(noteNonce)
    expect(screen.getByRole("button", { name: threadsCopy.point(1) })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: `Open improvement: ${note.body}` }))
    const conversation = screen.getByRole("dialog", { name: threadsCopy.conversation })
    const reply = within(conversation).getByRole("textbox", {
      name: threadsCopy.comments.replyLabel,
    })
    fireEvent.change(reply, { target: { value: "Keep this follow-up draft." } })
    expect(comments).toBeDisabled()
    fireEvent.click(comments)
    expect(conversation).toBeVisible()
    expect(reply).toHaveValue("Keep this follow-up draft.")
    fireEvent.change(reply, { target: { value: "" } })
    fireEvent.click(within(conversation).getByRole("button", { name: threadsCopy.back }))

    bridge.post.mockClear()
    fireEvent.click(comments)
    bridge.ready()
    expect(await screen.findByRole("searchbox", { name: commentsCopy.searchLabel })).toBeVisible()
    expect(screen.getByRole("button", { name: /Please align this control/ })).toBeVisible()
    expect(screen.queryByRole("complementary", { name: notesCopy.notes })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: threadsCopy.point(1) })).not.toBeInTheDocument()
    const commentNonce = bridge.resolveNonce("#comment-target")
    expect(commentNonce).not.toBe(noteNonce)
    expect(
      bridge
        .messages()
        .some(
          (data) =>
            data.type === "replica:canvas:resolve" &&
            data.anchors?.some(
              ({ anchor }) => anchor.kind === "element" && anchor.selector === "#note-target",
            ),
        ),
    ).toBe(false)
    bridge.resolve(noteNonce)
    expect(
      screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
    ).not.toBeInTheDocument()
    bridge.resolve(commentNonce)
    expect(screen.getByRole("button", { name: "Unread thread started by @octocat" })).toBeVisible()

    bridge.post.mockClear()
    fireEvent.click(improvements)
    bridge.ready()
    expect(await screen.findByRole("complementary", { name: notesCopy.notes })).toBeVisible()
    expect(screen.getByRole("button", { name: `Open improvement: ${note.body}` })).toBeVisible()
    expect(
      screen.queryByRole("searchbox", { name: commentsCopy.searchLabel }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
    ).not.toBeInTheDocument()
    bridge.resolve(bridge.resolveNonce("#note-target"))
    expect(screen.getByRole("button", { name: threadsCopy.point(1) })).toBeVisible()
    expect(saved.notes).toEqual([note])
    expect(
      fetch.mock.calls.filter(
        ([path, options]) =>
          options?.method === "POST" &&
          (path.startsWith("/api/hub/comments") || path.startsWith("/api/improvement-notes")) &&
          path !== "/api/improvement-notes/sync",
      ),
    ).toEqual([])
    view.unmount()
  })

  it.each(["element", "area"] as const)(
    "opens only the selected %s comment composer or improvement composer and protects its draft",
    async (mode) => {
      const { comment } = reviewFixture()
      const view = render(
        <App
          config={{
            name: "Demo",
            prototypeUrl: "http://localhost:4321/",
            token: "local",
            pickAndPolish: true,
          }}
        />,
      )
      const comments = await screen.findByRole("button", { name: /^Comments, 1/ })
      const improvements = await screen.findByRole("button", { name: notesCopy.openNotes(1) })
      const bridge = previewBridge()
      const noteNonce = bridge.resolveNonce("#note-target")
      if (mode === "area") {
        fireEvent.click(comments)
        bridge.ready()
      }
      fireEvent.click(screen.getByRole("button", { name: commentsCopy.commentMenuLabel }))
      fireEvent.click(
        screen.getByRole("menuitem", {
          name:
            mode === "element"
              ? commentsCopy.commentOnElementLabel
              : commentsCopy.highlightRegionLabel,
        }),
      )
      bridge.ready()
      const commentNonce = bridge.resolveNonce("#comment-target")
      await waitFor(() =>
        expect(bridge.post).toHaveBeenCalledWith(
          { type: "replica:canvas:select", nonce: commentNonce, mode },
          "http://localhost:4321",
        ),
      )
      fireEvent.click(screen.getByRole("button", { name: notesCopy.annotate }))
      expect(improvements).toBeDisabled()
      const anchor =
        mode === "element"
          ? comment.anchor
          : {
              schemaVersion: 1,
              kind: "area",
              route: comment.anchor.route,
              rect: comment.anchor.rect,
              viewport: comment.anchor.viewport,
              path: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              elements: [],
            }
      bridge.receive(noteNonce, { type: "replica:canvas:selected", anchor })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      bridge.receive(commentNonce, { type: "replica:canvas:selected", anchor })
      const composer = screen.getByRole("dialog", { name: commentsCopy.composerHeading })
      expect(screen.getAllByRole("dialog")).toEqual([composer])
      const draft = within(composer).getByRole("textbox", { name: commentsCopy.composerLabel })
      fireEvent.change(draft, { target: { value: "Keep this comment draft." } })
      fireEvent.click(improvements)
      expect(composer).toBeVisible()
      expect(draft).toHaveValue("Keep this comment draft.")
      fireEvent.keyDown(draft, { key: "Escape" })
      fireEvent.click(screen.getByRole("button", { name: commentsCopy.discardButtonLabel }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

      fireEvent.click(screen.getByRole("button", { name: notesCopy.annotate }))
      bridge.ready()
      const currentNoteNonce = bridge.resolveNonce("#note-target")
      await waitFor(() =>
        expect(bridge.post).toHaveBeenCalledWith(
          { type: "replica:canvas:select", nonce: currentNoteNonce, mode: "improvement" },
          "http://localhost:4321",
        ),
      )
      bridge.receive(commentNonce, { type: "replica:canvas:selected", anchor })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      bridge.receive(currentNoteNonce, { type: "replica:canvas:selected", anchor })
      const noteComposer = screen.getByRole("dialog", { name: notesCopy.add })
      expect(screen.getAllByRole("dialog")).toEqual([noteComposer])
      const noteDraft = within(noteComposer).getByRole("textbox", { name: notesCopy.label })
      fireEvent.change(noteDraft, { target: { value: "Keep this improvement draft." } })
      fireEvent.click(comments)
      expect(noteComposer).toBeVisible()
      expect(noteDraft).toHaveValue("Keep this improvement draft.")
      expect(screen.getByRole("button", { name: commentsCopy.commentMenuLabel })).toBeDisabled()
      view.unmount()
    },
  )

  it("does not let comments cross-start while an improvement source capture is pending", async () => {
    const { fetch } = reviewFixture()
    const original = fetch.getMockImplementation()!
    let completeCapture!: (response: Response) => void
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes/capture"
        ? new Promise<Response>((resolve) => {
            completeCapture = resolve
          })
        : original(path, options),
    )
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: "http://localhost:4321/",
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const comments = await screen.findByRole("button", { name: /^Comments, 1/ })
    await screen.findByRole("button", { name: notesCopy.openNotes(1) })
    const bridge = previewBridge()
    fireEvent.click(screen.getByRole("button", { name: notesCopy.annotate }))
    await waitFor(() => expect(completeCapture).toBeTypeOf("function"))
    expect(comments).toBeDisabled()
    const addComment = screen.getByRole("button", { name: commentsCopy.commentMenuLabel })
    expect(addComment).toBeDisabled()
    fireEvent.click(comments)
    fireEvent.click(addComment)
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("searchbox", { name: commentsCopy.searchLabel }),
    ).not.toBeInTheDocument()
    act(() => {
      completeCapture(Response.json({ identity: "review-notes", sourceId: "selected-source" }))
    })
    await waitFor(() =>
      expect(bridge.post).toHaveBeenCalledWith(
        {
          type: "replica:canvas:select",
          nonce: bridge.resolveNonce("#note-target"),
          mode: "improvement",
        },
        "http://localhost:4321",
      ),
    )
    const modes = bridge
      .messages()
      .filter((data) => data.type === "replica:canvas:select")
      .map((data) => data.mode)
    expect(modes).toEqual(["improvement"])
    view.unmount()
  })
})
