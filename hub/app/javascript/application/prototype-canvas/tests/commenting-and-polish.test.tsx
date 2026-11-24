import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type * as AnnotationShortcut from "@utils/is-annotation-shortcut"
import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { copy as notesCopy } from "@features/prototype-canvas-improvement-notes/en"
import type { Note } from "@features/prototype-canvas-improvement-notes/types"
import { copy as threadsCopy } from "@features/prototype-canvas-improvement-threads/en"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { reviewCommentsCopy as commentsCopy } from "@utils/review-comment/en"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"
import type { HubStatus } from "@utils/prototype-canvas/types"

import { App } from ".."
import { sharingFixture } from "./sharing-fixture"

vi.mock("@utils/is-annotation-shortcut", async (importOriginal) => {
  const actual = await importOriginal<typeof AnnotationShortcut>()
  const { asTrustedKeyboardEvent } = await import("@/test/as-trusted-keyboard-event")
  return {
    ...actual,
    isAnnotationShortcut(event: KeyboardEvent, shortcut?: "s" | "c", shiftKey = false) {
      return actual.isAnnotationShortcut(asTrustedKeyboardEvent(event), shortcut, shiftKey)
    },
  }
})

afterEach(() => {
  Reflect.deleteProperty(navigator, "userActivation")
})

// Keep cold loading of the real lazy feature outside the interaction test budget.
beforeAll(async () => {
  await import("@features/prototype-canvas-improvement-notes")
})

function reviewFixture(hubOverrides: Partial<HubStatus> = {}) {
  const { fetch } = sharingFixture(undefined, {
    ...publicationHub,
    state: "connected",
    repositoryAuthorized: true,
    viewerLogin: "octocat",
    prototype: importedPrototype,
    ...hubOverrides,
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
    if (path === "/api/hub/comments" || path.startsWith("/api/hub/comments?"))
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
    commentShortcut: z.boolean().optional(),
    selectionShortcut: z.boolean().optional(),
    pinsShortcut: z.boolean().optional(),
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
  return { frame, post, messages, ready, receive, resolve, resolveNonce }
}

describe("App()", () => {
  it("toggles unified comment selection with C without starting Pick & polish", async () => {
    const { fetch } = reviewFixture()
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
    await screen.findByRole("button", { name: /^Comments, 1/ })
    const picker = await screen.findByRole("button", { name: notesCopy.annotate })
    fireEvent.keyDown(window, { key: "c" })
    expect(screen.queryByRole("button", { name: commentsCopy.cancelSelectionLabel })).toBeNull()
    const bridge = previewBridge()
    function select() {
      return bridge.messages().filter((data) => data.type === "replica:canvas:select")
    }
    fireEvent.click(screen.getByRole("button", { name: commentsCopy.commentMenuLabel }))
    const menu = screen.getByRole("menu")
    expect(
      within(menu).getByRole("menuitem", { name: commentsCopy.commentMenuLabel }),
    ).toHaveAttribute("aria-keyshortcuts", "C")
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2)
    bridge.post.mockClear()
    fireEvent.keyDown(window, { key: "c" })
    expect(select()).toEqual([])
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    bridge.post.mockClear()
    fireEvent.keyDown(window, { key: "c" })
    bridge.ready()
    await waitFor(() => expect(select().at(-1)?.mode).toBe("comment"))
    expect(picker).toHaveAttribute("aria-pressed", "false")
    bridge.post.mockClear()
    fireEvent.keyDown(window, { key: "C" })
    expect(await screen.findByRole("button", { name: commentsCopy.commentMenuLabel })).toBeEnabled()
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Edit details" }))
    expect(select()).toEqual([])
    expect(bridge.messages().some((data) => data.type === "replica:canvas:cancel-selection")).toBe(
      true,
    )
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/capture"))).toBe(false)
    view.unmount()
  })

  it("does not start comments when the preview is ready but repository review is unauthorized", async () => {
    reviewFixture({
      repositoryAuthorized: false,
      prototype: undefined,
      reviewRevision: undefined,
      reviewError: "Repository review is not authorized.",
    })
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
    await screen.findByRole("button", { name: notesCopy.annotate })
    const bridge = previewBridge()
    bridge.post.mockClear()
    fireEvent.keyDown(window, { key: "c" })
    fireEvent.keyDown(window, { key: "C", shiftKey: true })
    expect(bridge.messages().some((data) => data.type === "replica:canvas:select")).toBe(false)
    expect(bridge.messages().some((data) => data.commentShortcut === true)).toBe(false)
    expect(bridge.messages().some((data) => data.pinsShortcut === true)).toBe(false)
    expect(screen.queryByRole("dialog", { name: commentsCopy.composerHeading })).toBeNull()
    view.unmount()
  })

  it("toggles comment pins with the menu and the comments panel with Shift+C without interrupting typing", async () => {
    reviewFixture()
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
    const bridge = previewBridge()
    fireEvent.click(comments)
    bridge.ready()
    const search = await screen.findByRole("searchbox", { name: commentsCopy.searchLabel })
    bridge.resolve(bridge.resolveNonce("#comment-target"))
    function pin() {
      return screen.queryByRole("button", { name: "Unread thread started by @octocat" })
    }
    expect(pin()).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: commentsCopy.commentMenuLabel }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide comments" }))
    expect(pin()).not.toBeInTheDocument()
    expect(search).toBeVisible()
    expect(comments).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: /Please align this control/ })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: commentsCopy.commentMenuLabel }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Show comments" }))
    expect(pin()).toBeVisible()

    expect(comments).toHaveAttribute("aria-keyshortcuts", "Shift+C")
    fireEvent.keyDown(search, { key: "C", shiftKey: true })
    expect(search).toBeVisible()
    fireEvent.keyDown(window, { key: "C", shiftKey: true })
    expect(comments).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("searchbox", { name: commentsCopy.searchLabel }),
    ).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: "C", shiftKey: true })
    expect(comments).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByRole("searchbox", { name: commentsCopy.searchLabel })).toBeVisible()
    view.unmount()
  })

  it("accepts iframe Shift+C only from the focused and activated preview with its comments nonce", async () => {
    reviewFixture()
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
    const bridge = previewBridge()
    fireEvent.click(comments)
    bridge.ready()
    await screen.findByRole("searchbox", { name: commentsCopy.searchLabel })
    bridge.resolve(bridge.resolveNonce("#comment-target"))
    function pin() {
      return screen.queryByRole("button", { name: "Unread thread started by @octocat" })
    }
    expect(pin()).toBeVisible()
    const nonce = bridge.messages().findLast((data) => data.pinsShortcut === true)?.nonce
    expect(nonce).toBeTypeOf("string")
    if (!nonce) throw new Error("Expected pins shortcut opt-in.")
    const noteNonce = bridge.messages().find((data) => data.selectionShortcut)?.nonce
    expect(noteNonce).toBeTypeOf("string")
    const message = { type: "replica:canvas:comment-visibility-toggle-requested", nonce }
    const origin = new URL(bridge.frame.src).origin
    function send(data = message, requestOrigin = origin, source = bridge.frame.contentWindow) {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, origin: requestOrigin, source }))
      })
      expect(comments).toHaveAttribute("aria-expanded", "true")
    }
    function activation(isActive: boolean) {
      Object.defineProperty(navigator, "userActivation", {
        configurable: true,
        value: { isActive },
      })
    }
    act(() => bridge.frame.focus())
    Reflect.deleteProperty(navigator, "userActivation")
    send()
    activation(false)
    send()
    activation(true)
    act(() => comments.focus())
    send()
    act(() => bridge.frame.focus())
    send(message, "https://untrusted.example")
    send(message, origin, window)
    send({ ...message, nonce: "stale" })
    send({ ...message, nonce: noteNonce! })

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: message,
          origin,
          source: bridge.frame.contentWindow,
        }),
      )
    })
    expect(comments).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("searchbox", { name: commentsCopy.searchLabel }),
    ).not.toBeInTheDocument()
    const reopenNonce = bridge.messages().findLast((data) => data.pinsShortcut === true)?.nonce
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { ...message, nonce: reopenNonce },
          origin,
          source: bridge.frame.contentWindow,
        }),
      )
    })
    expect(comments).toHaveAttribute("aria-expanded", "true")
    view.unmount()
  })

  it("accepts iframe C only with the comment nonce, expected source and origin, focus and activation", async () => {
    reviewFixture()
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
    await screen.findByRole("button", { name: /^Comments, 1/ })
    await screen.findByRole("button", { name: notesCopy.annotate })
    const bridge = previewBridge()
    const commentNonce = bridge
      .messages()
      .find((data) => data.type === "replica:canvas:request-ready" && data.commentShortcut)?.nonce
    expect(commentNonce).toBeTypeOf("string")
    if (!commentNonce) throw new Error("Expected comment shortcut opt-in.")
    const noteNonce = bridge.messages().find((data) => data.selectionShortcut)?.nonce
    expect(noteNonce).toBeTypeOf("string")
    expect(noteNonce).not.toBe(commentNonce)
    const message = { type: "replica:canvas:comment-cycle-requested", nonce: commentNonce }
    function send(
      data = message,
      origin = new URL(bridge.frame.src).origin,
      source = bridge.frame.contentWindow,
    ) {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, origin, source }))
      })
    }
    function activation(isActive: boolean) {
      Object.defineProperty(navigator, "userActivation", {
        configurable: true,
        value: { isActive },
      })
    }
    bridge.post.mockClear()
    act(() => bridge.frame.focus())
    activation(false)
    send()
    activation(true)
    act(() => screen.getByRole("button", { name: notesCopy.annotate }).focus())
    send()
    act(() => bridge.frame.focus())
    send(message, "https://untrusted.example")
    send(message, new URL(bridge.frame.src).origin, window)
    send({ ...message, nonce: "stale-comment" })
    send({ ...message, nonce: noteNonce! })
    expect(bridge.messages().filter((data) => data.type === "replica:canvas:select")).toEqual([])
    act(() => bridge.frame.focus())
    send()
    bridge.ready()
    await waitFor(() =>
      expect(
        bridge
          .messages()
          .filter((data) => data.type === "replica:canvas:select")
          .at(-1)?.mode,
      ).toBe("comment"),
    )
    bridge.post.mockClear()
    act(() => bridge.frame.focus())
    send()
    expect(await screen.findByRole("button", { name: commentsCopy.commentMenuLabel })).toBeEnabled()
    expect(bridge.messages().filter((data) => data.type === "replica:canvas:select")).toEqual([])
    expect(bridge.post).toHaveBeenCalledWith(
      { type: "replica:canvas:cancel-selection", nonce: commentNonce },
      "http://localhost:4321",
    )
    view.unmount()
  })

  it("keeps saved notes closed and selection off on load and after reopening the canvas", async () => {
    const { fetch, note } = reviewFixture()
    const config = {
      name: "Demo",
      prototypeUrl: "http://localhost:4321/",
      token: "local",
      pickAndPolish: true,
    }
    for (let load = 0; load < 2; load++) {
      const view = render(<App config={config} />)
      const improvements = await screen.findByRole("button", {
        name: notesCopy.openNotes(1),
      })
      const picker = screen.getByRole("button", { name: notesCopy.annotate })
      const bridge = previewBridge()
      expect(improvements).toHaveAttribute("aria-expanded", "false")
      expect(picker).toHaveAttribute("aria-pressed", "false")
      expect(screen.queryByRole("complementary", { name: notesCopy.notes })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: threadsCopy.point(1) })).not.toBeInTheDocument()
      expect(bridge.messages().some((data) => data.type === "replica:canvas:select")).toBe(false)
      expect(fetch.mock.calls.some(([path]) => path === "/api/improvement-notes/capture")).toBe(
        false,
      )

      fireEvent.click(improvements)
      bridge.ready()
      expect(await screen.findByRole("button", { name: `Open note: ${note.body}` })).toBeVisible()
      expect(picker).toHaveAttribute("aria-pressed", "false")
      view.unmount()
    }
  })

  it("opens the comments panel with its pins from Notes with Shift+C", async () => {
    const { note } = reviewFixture()
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
    const improvements = await screen.findByRole("button", {
      name: /^(Open|Close) Notes \(1\)$/,
    })
    const bridge = previewBridge()
    fireEvent.click(comments)
    bridge.ready()
    await screen.findByRole("searchbox", { name: commentsCopy.searchLabel })
    bridge.resolve(bridge.resolveNonce("#comment-target"))

    fireEvent.click(improvements)
    bridge.ready()
    expect(await screen.findByRole("button", { name: `Open note: ${note.body}` })).toBeVisible()
    fireEvent.keyDown(window, { key: "C", shiftKey: true })
    bridge.ready()
    bridge.resolve(bridge.resolveNonce("#comment-target"))
    expect(screen.getByRole("button", { name: "Unread thread started by @octocat" })).toBeVisible()
    expect(screen.getByRole("searchbox", { name: commentsCopy.searchLabel })).toBeVisible()
    expect(screen.queryByRole("complementary", { name: notesCopy.notes })).not.toBeInTheDocument()
    view.unmount()
  })

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
    // Starter changes also run this suite; synchronize its lazy review surfaces before interaction.
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const comments = await screen.findByRole("button", { name: /^Comments, 1/ })
    const improvements = await screen.findByRole("button", {
      name: /^(Open|Close) Notes \(1\)$/,
    })
    expect(screen.getByRole("button", { name: commentsCopy.commentMenuLabel })).toBeVisible()
    expect(screen.getByRole("button", { name: notesCopy.annotate })).toBeVisible()
    const bridge = previewBridge()
    fireEvent.click(improvements)
    bridge.ready()
    expect(await screen.findByRole("complementary", { name: notesCopy.notes })).toBeVisible()
    expect(screen.getByRole("button", { name: `Open note: ${note.body}` })).toBeVisible()
    const noteNonce = bridge.resolveNonce("#note-target")
    bridge.resolve(noteNonce)
    expect(screen.getByRole("button", { name: threadsCopy.point(1) })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${note.body}` }))
    const conversation = screen.getByRole("dialog", { name: note.target })
    const reply = within(conversation).getByRole("textbox", {
      name: threadsCopy.comments.replyLabel,
    })
    fireEvent.change(reply, { target: { value: "Keep this follow-up draft." } })
    fireEvent.keyDown(window, { key: "c" })
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
    expect(screen.getByRole("button", { name: `Open note: ${note.body}` })).toBeVisible()
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
      const improvements = await screen.findByRole("button", {
        name: /^(Open|Close) Notes \(1\)$/,
      })
      const bridge = previewBridge()
      fireEvent.click(improvements)
      bridge.ready()
      const noteNonce = bridge.resolveNonce("#note-target")
      fireEvent.click(improvements)
      if (mode === "area") {
        fireEvent.click(comments)
        bridge.ready()
      }
      fireEvent.click(screen.getByRole("button", { name: commentsCopy.commentMenuLabel }))
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: commentsCopy.commentMenuLabel,
        }),
      )
      bridge.ready()
      const commentNonce = bridge.resolveNonce("#comment-target")
      await waitFor(() =>
        expect(bridge.post).toHaveBeenCalledWith(
          { type: "replica:canvas:select", nonce: commentNonce, mode: "comment" },
          "http://localhost:4321",
        ),
      )
      fireEvent.click(screen.getByRole("button", { name: notesCopy.annotate }))
      fireEvent.keyDown(window, { key: "s" })
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
      fireEvent.keyDown(window, { key: "c" })
      fireEvent.keyDown(draft, { key: "C", shiftKey: true })
      fireEvent.keyDown(window, { key: "C", shiftKey: true })
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
      fireEvent.keyDown(window, { key: "c" })
      fireEvent.keyDown(noteDraft, { key: "C", shiftKey: true })
      fireEvent.keyDown(window, { key: "C", shiftKey: true })
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
    await screen.findByRole("button", { name: /^(Open|Close) Notes \(1\)$/ })
    const bridge = previewBridge()
    fireEvent.click(screen.getByRole("button", { name: notesCopy.annotate }))
    bridge.ready()
    await waitFor(() => expect(completeCapture).toBeTypeOf("function"))
    expect(comments).toBeDisabled()
    const addComment = screen.getByRole("button", { name: commentsCopy.commentMenuLabel })
    expect(addComment).toBeDisabled()
    fireEvent.click(comments)
    fireEvent.click(addComment)
    fireEvent.keyDown(window, { key: "c" })
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
    expect(new Set(modes)).toEqual(new Set(["improvement"]))
    view.unmount()
  })
})
