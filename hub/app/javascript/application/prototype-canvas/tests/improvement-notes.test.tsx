import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type * as AnnotationShortcut from "@utils/is-annotation-shortcut"
import { copy } from "@features/prototype-canvas-improvement-notes/en"
import { copy as threadCopy } from "@features/prototype-canvas-improvement-threads/en"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."
import type { Note } from "@features/prototype-canvas-improvement-notes/types"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { ImprovementNotesPrototype } from "@features/prototype-canvas-improvement-notes"

vi.mock("@utils/is-annotation-shortcut", async (importOriginal) => {
  const actual = await importOriginal<typeof AnnotationShortcut>()
  const { asTrustedKeyboardEvent } = await import("@/test/as-trusted-keyboard-event")
  return {
    ...actual,
    isAnnotationShortcut(event: KeyboardEvent, shortcut?: "s" | "c") {
      return actual.isAnnotationShortcut(asTrustedKeyboardEvent(event), shortcut)
    },
  }
})

const nonce = "00000000-0000-4000-8000-000000000003"
const origin = "http://localhost:4321"
const anchor = {
  schemaVersion: 1,
  kind: "element",
  route: { pathname: "/settings", search: "?tab=account", hash: "#profile" },
  selector: "#save",
  accessibleName: "Save",
  tagName: "button",
  selectedText: "",
  rect: { x: 20, y: 30, width: 120, height: 40 },
  viewport: { width: 960, height: 560, scrollX: 0, scrollY: 0 },
  elementOffset: { x: 0.5, y: 0.5 },
}

function receive(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
  eventOrigin = new URL(frame.src).origin,
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: eventOrigin,
        data: { nonce, ...data },
      }),
    )
  })
}

function setUserActivation(isActive: boolean) {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: isActive, isActive },
  })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "userActivation")
})

function savedNotesFixture(captureFails = false) {
  const { fetch } = sharingFixture()
  const original = fetch.getMockImplementation()!
  const saved = {
    identity: "notes",
    revision: 0,
    notes: [] as Note[],
    syncError: null as string | null,
    activeBatch: null as string | null,
  }
  fetch.mockImplementation(async (path, options) => {
    if (!path.startsWith("/api/improvement-notes")) return original(path, options)
    if (path.endsWith("/capture"))
      return captureFails
        ? Response.json({ error: "Source capture unavailable." }, { status: 409 })
        : Response.json({ identity: saved.identity, sourceId: "selected-source" })
    if (options?.method === "POST") {
      if (typeof options.body !== "string") throw new Error("Expected a JSON notes request.")
      const input: unknown = JSON.parse(options.body)
      if (path.endsWith("/fix")) {
        if (!input || typeof input !== "object") throw new Error("Expected a fix request.")
        if (
          !("identity" in input) ||
          input.identity !== saved.identity ||
          !("revision" in input) ||
          input.revision !== saved.revision
        )
          return Response.json({ error: "The notes changed." }, { status: 409 })
        const ids = "noteIds" in input && Array.isArray(input.noteIds) ? input.noteIds : null
        const selected = saved.notes.filter(
          (note) =>
            note.status === "open" &&
            (ids === null ||
              ids.some(
                (entry: { id: number; revision: number }) =>
                  entry.id === note.id && entry.revision === note.revision,
              )),
        )
        if (ids !== null && selected.length !== ids.length)
          return Response.json({ error: "This note changed while it was open." }, { status: 409 })
        saved.activeBatch ??= "batch"
        selected.forEach((note) => {
          note.status = "sent"
          if (note.thread.originalStatus === "open") note.thread.originalStatus = "sent"
          for (const message of note.thread.messages)
            if (message.role === "author" && message.status === "open") message.status = "sent"
          note.revision++
        })
      } else if (!path.endsWith("/sync")) {
        if (!input || typeof input !== "object") throw new Error("Expected a notes request.")
        if (
          "operation" in input &&
          ["edit", "follow-up", "delete"].includes(String(input.operation))
        ) {
          const note = saved.notes.find((item) => "id" in input && item.id === input.id)
          if (
            !note ||
            !("expectedNoteRevision" in input) ||
            note.revision !== input.expectedNoteRevision
          )
            return Response.json({ error: "This note changed while it was open." }, { status: 409 })
          if (input.operation === "delete")
            saved.notes = saved.notes.filter((item) => item !== note)
          else if (input.operation === "follow-up") {
            if (!("body" in input) || typeof input.body !== "string")
              throw new Error("Expected the follow-up body.")
            note.thread.messages.push({
              id: crypto.randomUUID(),
              role: "author",
              body: input.body,
              status: "open",
            })
            note.status = "open"
            note.revision++
          } else
            return Response.json({ error: "Improvement requests are read-only." }, { status: 409 })
          saved.revision++
          return Response.json(saved)
        }
        if (!("anchor" in input) || !("body" in input) || typeof input.body !== "string")
          throw new Error("Expected a note and its anchor.")
        const selected = REVIEW_ANCHOR_SCHEMA.parse(input.anchor)
        saved.notes.push({
          anchor: selected,
          body: input.body,
          thread: { originalStatus: "open", messages: [] },
          id: saved.notes.length + 1,
          localId: crypto.randomUUID(),
          kind: "improvement_note",
          author: "local",
          status: "open",
          sync: "local",
          revision: 1,
          route: selected.route.pathname + selected.route.search + selected.route.hash,
          target: selected.kind === "element" ? selected.accessibleName : "Selected region",
          selector: selected.kind === "element" ? selected.selector : null,
          rect: selected.rect,
        })
      }
      saved.revision++
    }
    return Response.json(saved)
  })
  return { fetch, saved }
}

describe("App()", () => {
  it("toggles selection with plain S only when ready and keeps Escape cancellation", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch } = savedNotesFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const picker = await screen.findByRole("button", { name: copy.annotate })
    expect(picker).not.toHaveAttribute("title")
    const pickerTooltip = screen.getByText(copy.annotateShortcut)
    expect(pickerTooltip).toHaveAttribute("role", "tooltip")
    expect(pickerTooltip).toHaveAttribute("data-shortcut", "S")
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    function captures() {
      return fetch.mock.calls.filter(([path]) => path === "/api/improvement-notes/capture")
    }
    fireEvent.keyDown(window, { key: "s" })
    expect(captures()).toHaveLength(0)
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    const shortcutFocus = document.createElement("button")
    document.body.append(shortcutFocus)
    shortcutFocus.focus()
    fireEvent.keyDown(shortcutFocus, { key: "s" })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    expect(picker).toHaveAttribute("aria-pressed", "true")
    expect(post).toHaveBeenCalledWith(
      { type: "replica:canvas:select", nonce, mode: "improvement" },
      origin,
    )
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    fireEvent.keyDown(shortcutFocus, { key: "S" })
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(shortcutFocus).toHaveFocus()
    expect(captures()).toHaveLength(1)
    fireEvent.keyDown(window, { key: "s" })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(captures()).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    await screen.findByRole("complementary", { name: "Hub" })
    fireEvent.keyDown(window, { key: "s" })
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(captures()).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "Close Hub" }))
    await act(async () => {
      fireEvent.click(picker)
      await Promise.resolve()
    })
    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Preserve this draft." },
    })
    fireEvent.keyDown(window, { key: "s" })
    expect(captures()).toHaveLength(3)
    expect(picker).toHaveAttribute("aria-pressed", "true")
    expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue("Preserve this draft.")
    shortcutFocus.remove()
    view.unmount()
  })

  it("accepts selection toggles only from the current focused preview during user activation", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch } = savedNotesFixture()
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: origin,
          previewUrl: "http://127.0.0.1:6789/",
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const picker = await screen.findByRole("button", { name: copy.annotate })
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    fireEvent.load(frame)
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "replica:canvas:request-ready",
          nonce,
          selectionShortcut: true,
        }),
        new URL(frame.src).origin,
      ),
    )
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    const toggle = { type: "replica:canvas:selection-toggle-requested", nonce }
    act(() => frame.focus())
    setUserActivation(false)
    receive(frame, toggle)
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(0)

    setUserActivation(true)
    act(() => picker.focus())
    receive(frame, toggle)
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(0)

    act(() => frame.focus())
    receive(frame, toggle, origin)
    receive(frame, { ...toggle, nonce: "stale-resolution" })
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: new URL(frame.src).origin,
          data: toggle,
        }),
      )
    })
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(0)
    receive(frame, toggle)
    expect(picker).toHaveAttribute("aria-pressed", "true")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(1)
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })

    setUserActivation(false)
    receive(frame, toggle)
    expect(picker).toHaveAttribute("aria-pressed", "true")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(1)

    setUserActivation(true)
    receive(frame, toggle)
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(1)
    view.unmount()
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:canvas:request-ready",
        nonce,
        selectionShortcut: false,
      }),
      new URL(frame.src).origin,
    )
  })

  it("arms selection before source capture finishes and saves an early target with its captured source", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    const original = fetch.getMockImplementation()!
    let finishCapture!: (response: Response) => void
    const capture = new Promise<Response>((resolve) => {
      finishCapture = resolve
    })
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes/capture" && options?.method === "POST"
        ? capture
        : original(path, options),
    )
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/settings?tab=account#profile`,
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    fireEvent.click(screen.getByRole("button", { name: copy.openNotes(0) }))
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()
    fireEvent.click(picker)

    expect(fetch).toHaveBeenCalledWith(
      "/api/improvement-notes/capture",
      expect.objectContaining({ method: "POST" }),
    )
    expect(picker).toHaveAttribute("aria-pressed", "true")
    expect(picker).toBeEnabled()
    expect(post).toHaveBeenCalledWith(
      { type: "replica:canvas:select", nonce, mode: "improvement" },
      origin,
    )
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    receive(frame, { type: "replica:canvas:selected", anchor })
    receive(frame, {
      type: "replica:canvas:conversation-dismiss-requested",
      restoreFocus: false,
    })
    expect(picker).toHaveAttribute("aria-pressed", "true")
    await act(async () => {
      finishCapture(Response.json({ identity: saved.identity, sourceId: "early-target-source" }))
      await capture
    })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    const note = composer.getByRole("textbox", { name: copy.label })
    const save = composer.getByRole("button", { name: copy.save })
    expect(save).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter")
    fireEvent.change(note, {
      target: { value: "Keep the selected action visible." },
    })
    fireEvent.keyDown(note, { key: "Enter", metaKey: true })
    await waitFor(() => expect(saved.notes).toHaveLength(1))
    const write = fetch.mock.calls.find(
      ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
    )
    if (typeof write?.[1]?.body !== "string") throw new Error("Expected a serialized improvement.")
    expect(JSON.parse(write[1].body)).toMatchObject({
      identity: saved.identity,
      sourceId: "early-target-source",
      anchor,
    })
    await waitFor(() => expect(picker).toHaveAttribute("aria-pressed", "true"))
    expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()
    const notesToggle = screen.getByRole("button", { name: copy.openNotes(1) })
    expect(notesToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    act(() => notesToggle.focus())
    fireEvent.click(notesToggle)
    expect(notesToggle).toHaveFocus()
    expect(notesToggle).toHaveAttribute("aria-expanded", "true")
    expect(notesToggle).toHaveAccessibleName(copy.closeNotes(1))
    expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()
    fireEvent.click(notesToggle)
    expect(notesToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    view.unmount()
  })

  it("cancels pending captures from the toolbar, preview, and shortcut before saving the next selection", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    const original = fetch.getMockImplementation()!
    const captures: ((response: Response) => void)[] = []
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes/capture" && options?.method === "POST"
        ? new Promise<Response>((resolve) => {
            captures.push(resolve)
          })
        : original(path, options),
    )
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/settings?tab=account#profile`,
          previewUrl: "http://127.0.0.1:6789/settings?tab=account#profile",
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())

    const cancellations = [
      () => fireEvent.click(picker),
      () => receive(frame, { type: "replica:canvas:conversation-dismiss-requested" }),
      () => fireEvent.keyDown(window, { key: "s" }),
    ]
    for (const [index, cancel] of cancellations.entries()) {
      fireEvent.click(picker)
      receive(frame, {
        type: "replica:canvas:ready",
        protocolVersion: 1,
        improvementSelection: true,
        route: anchor.route,
      })
      expect(picker).toHaveAttribute("aria-pressed", "true")
      expect(picker).toBeEnabled()
      expect(captures).toHaveLength(index + 1)
      const cancelledAnchor = {
        ...anchor,
        selector: `#cancelled-${index}`,
        accessibleName: `Cancelled ${index}`,
      }
      receive(frame, { type: "replica:canvas:selected", anchor: cancelledAnchor })

      cancel()
      expect(picker).toHaveAttribute("aria-pressed", "false")
      await act(async () => {
        captures[index]!(
          Response.json({ identity: saved.identity, sourceId: `cancelled-source-${index}` }),
        )
        await Promise.resolve()
      })
      expect(picker).toHaveAttribute("aria-pressed", "false")
      expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()
      receive(frame, { type: "replica:canvas:selected", anchor: cancelledAnchor })
      expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()
    }

    fireEvent.click(picker)
    expect(captures).toHaveLength(4)
    const nextAnchor = { ...anchor, selector: "#next", accessibleName: "Next" }
    receive(frame, { type: "replica:canvas:selected", anchor: nextAnchor })
    await act(async () => {
      captures[3]!(Response.json({ identity: saved.identity, sourceId: "next-selection-source" }))
      await Promise.resolve()
    })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Clarify the next action." },
    })
    fireEvent.click(composer.getByRole("button", { name: copy.save }))
    await waitFor(() => expect(saved.notes).toHaveLength(1))
    const write = fetch.mock.calls.find(
      ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
    )
    if (typeof write?.[1]?.body !== "string") throw new Error("Expected a serialized improvement.")
    expect(JSON.parse(write[1].body)).toMatchObject({
      identity: saved.identity,
      sourceId: "next-selection-source",
      anchor: nextAnchor,
    })
    view.unmount()
  })

  it("only dismisses saved conversations through the current authenticated preview connection and protects drafts", async () => {
    const { saved } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      localId: "original",
      kind: "improvement_note",
      author: "local",
      body: "Make the save action clearer.",
      route: "/settings?tab=account#profile",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      thread: { originalStatus: "open", messages: [] },
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "open",
      sync: "local",
      revision: 1,
    })
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/settings?tab=account#profile`,
          previewUrl: "http://127.0.0.1:6789/settings?tab=account#profile",
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    fireEvent.click(await screen.findByRole("button", { name: copy.openNotes(1) }))
    const card = await screen.findByRole("button", {
      name: "Open note: Make the save action clearer.",
    })
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    function selectionNonce() {
      for (const [data] of [...post.mock.calls].reverse()) {
        const message: unknown = data
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "replica:canvas:resolve" &&
          "anchors" in message &&
          Array.isArray(message.anchors) &&
          message.anchors.length === 1 &&
          "nonce" in message &&
          typeof message.nonce === "string"
        )
          return message.nonce
      }
      throw new Error("Expected a nonce for the saved improvement anchor.")
    }
    fireEvent.load(frame)
    const staleNonce = selectionNonce()
    fireEvent.load(frame)
    const currentNonce = selectionNonce()
    expect(currentNonce).not.toBe(staleNonce)
    receive(frame, {
      type: "replica:canvas:ready",
      nonce: currentNonce,
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(screen.getByRole("button", { name: copy.annotate })).toBeEnabled())
    receive(frame, {
      type: "replica:canvas:resolved",
      nonce: currentNonce,
      results: [{ id: 1, x: 80, y: 50 }],
    })
    fireEvent.click(card)
    const dismiss = { type: "replica:canvas:conversation-dismiss-requested", nonce: currentNonce }
    receive(frame, dismiss, origin)
    expect(screen.getByRole("dialog", { name: "Save" })).toBeVisible()
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: new URL(frame.src).origin,
          data: dismiss,
        }),
      )
    })
    expect(screen.getByRole("dialog", { name: "Save" })).toBeVisible()
    receive(frame, { ...dismiss, nonce: staleNonce })
    expect(screen.getByRole("dialog", { name: "Save" })).toBeVisible()
    receive(frame, dismiss)
    expect(screen.queryByRole("dialog", { name: "Save" })).not.toBeInTheDocument()
    expect(card).toHaveFocus()

    fireEvent.click(card)
    receive(frame, { ...dismiss, restoreFocus: false })
    expect(screen.queryByRole("dialog", { name: "Save" })).not.toBeInTheDocument()
    expect(card).not.toHaveFocus()

    fireEvent.click(card)
    fireEvent.change(screen.getByRole("textbox", { name: threadCopy.comments.replyLabel }), {
      target: { value: "Keep this unsent follow-up" },
    })
    receive(frame, dismiss)
    expect(screen.getByText(threadCopy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.keepLabel }))
    expect(screen.getByRole("textbox", { name: threadCopy.comments.replyLabel })).toHaveValue(
      "Keep this unsent follow-up",
    )
    const notesToggle = screen.getByRole("button", { name: copy.closeNotes(1) })
    fireEvent.pointerDown(notesToggle, { button: 0, isPrimary: true })
    fireEvent.click(notesToggle)
    expect(notesToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(threadCopy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.keepLabel }))
    fireEvent.click(notesToggle)
    expect(notesToggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(threadCopy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: "Save" })).not.toBeInTheDocument()
    expect(notesToggle).toHaveAttribute("aria-expanded", "false")
    expect(notesToggle).toHaveFocus()
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    view.unmount()
  })

  it.each([copy.save, "Fix now"])("keeps the unsaved draft when %s cannot save", async (action) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes" && options?.method === "POST"
        ? Promise.resolve(Response.json({ error: "Notes could not be saved." }, { status: 503 }))
        : original(path, options),
    )
    render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/settings?tab=account#profile`,
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const annotate = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(annotate).toBeEnabled())
    fireEvent.click(annotate)
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(annotate).toHaveAttribute("aria-pressed", "true"))
    receive(frame, { type: "replica:canvas:selected", anchor })
    const dialog = screen.getByRole("dialog", { name: copy.add })
    const composer = within(dialog)
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Keep the save action visible." },
    })
    fireEvent.click(composer.getByRole("button", { name: action }))
    const notifications = await screen.findByRole("region", { name: "Comment notifications" })
    const alert = within(notifications).getByRole("alert")
    expect(alert).toBeVisible()
    expect(alert).toHaveTextContent("Notes could not be saved.")
    const form = composer.getByRole("textbox", { name: copy.label }).closest("form")
    if (!form) throw new Error("Expected the improvement composer form.")
    expect(form).not.toContainElement(notifications)
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(form).queryByText("Notes could not be saved.")).not.toBeInTheDocument()
    expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue(
      "Keep the save action visible.",
    )
    expect(saved.notes).toHaveLength(0)
    expect(annotate).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))).toHaveLength(0)
    fireEvent.click(within(notifications).getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByText("Notes could not be saved.")).not.toBeInTheDocument()
    expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue(
      "Keep the save action visible.",
    )
  })

  it.each([copy.save, "Fix now"])("does not lose edits made while %s is saving", async (action) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    let releaseSave: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation(async (path, options) => {
      if (path === "/api/improvement-notes" && options?.method === "POST") await pendingSave
      return original(path, options)
    })
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    fireEvent.click(picker)
    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    const textbox = composer.getByRole("textbox", { name: copy.label })
    fireEvent.change(textbox, { target: { value: "Submitted draft" } })
    fireEvent.click(composer.getByRole("button", { name: action }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
        ),
      ).toHaveLength(1),
    )
    const locked =
      textbox.hasAttribute("disabled") ||
      textbox.hasAttribute("readonly") ||
      textbox.getAttribute("aria-disabled") === "true"
    if (!locked) fireEvent.change(textbox, { target: { value: "Edited while saving" } })
    await act(async () => {
      releaseSave?.()
      await pendingSave
    })
    await waitFor(() => {
      expect(saved.notes).toHaveLength(1)
      if (action === "Fix now")
        expect(fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))).toHaveLength(1)
    })
    expect(saved.notes[0]?.body).toBe("Submitted draft")
    if (!locked) {
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue(
          "Edited while saving",
        ),
      )
      await waitFor(() => expect(screen.getByRole("button", { name: copy.save })).toBeEnabled())
    }
  })

  it("does not discard a later composer draft when an earlier save finishes", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    let releaseSave: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation(async (path, options) => {
      if (path === "/api/improvement-notes" && options?.method === "POST") await pendingSave
      return original(path, options)
    })
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    fireEvent.click(picker)
    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Earlier draft" },
    })
    fireEvent.click(composer.getByRole("button", { name: copy.save }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
        ),
      ).toHaveLength(1),
    )
    const close = composer.getByRole("button", { name: copy.closeComposer })
    if (close.hasAttribute("disabled") || close.getAttribute("aria-disabled") === "true") {
      act(() => releaseSave?.())
      await waitFor(() => expect(saved.notes).toHaveLength(1))
      return
    }
    fireEvent.click(close)
    if (!screen.queryByRole("button", { name: copy.discard })) {
      expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("Earlier draft")
      act(() => releaseSave?.())
      await waitFor(() => expect(saved.notes).toHaveLength(1))
      return
    }
    fireEvent.click(screen.getByRole("button", { name: copy.discard }))
    fireEvent.click(picker)
    receive(frame, { type: "replica:canvas:selected", anchor })
    const later = within(await screen.findByRole("dialog", { name: copy.add }))
    fireEvent.change(later.getByRole("textbox", { name: copy.label }), {
      target: { value: "Later draft" },
    })
    await act(async () => {
      releaseSave?.()
      await pendingSave
    })
    await waitFor(() => expect(saved.notes).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("Later draft"),
    )
    expect(screen.getByRole("button", { name: copy.save })).toBeEnabled()
  })

  it("keeps saved pins and their protected conversation available in selection mode without a sidebar", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { saved, fetch } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      localId: "original",
      kind: "improvement_note",
      author: "local",
      body: "Make the save action clearer.",
      route: "/settings?tab=account#profile",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      thread: { originalStatus: "open", messages: [] },
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "open",
      sync: "local",
      revision: 1,
    })
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/settings?tab=account#profile`,
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    fireEvent.click(await screen.findByRole("button", { name: copy.openNotes(1) }))
    await screen.findByRole("button", {
      name: "Open note: Make the save action clearer.",
    })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    receive(frame, {
      type: "replica:canvas:resolved",
      results: [{ id: 1, x: 80, y: 50 }],
    })
    expect(screen.getByRole("button", { name: threadCopy.point(1) })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: threadCopy.close }))
    expect(screen.queryByRole("button", { name: threadCopy.point(1) })).not.toBeInTheDocument()
    fireEvent.click(picker)
    await waitFor(() => expect(picker).toHaveAttribute("aria-pressed", "true"))
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    const marker = screen.getByRole("button", { name: threadCopy.point(1) })
    expect(marker).toBeVisible()
    fireEvent.click(marker)
    const dialog = screen.getByRole("dialog", { name: "Save" })
    expect(dialog).toBeVisible()
    expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
    const input = within(dialog).getByRole("textbox", { name: threadCopy.comments.replyLabel })
    fireEvent.change(input, { target: { value: "Keep this unsent follow-up" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.getByText(threadCopy.comments.threadDiscardPromptLabel)).toBeVisible()
    expect(picker).toHaveAttribute("aria-pressed", "true")
    fireEvent.keyDown(dialog, { key: "Escape" })
    const retainedInput = within(dialog).getByRole("textbox", {
      name: threadCopy.comments.replyLabel,
    })
    expect(retainedInput).toHaveValue("Keep this unsent follow-up")
    fireEvent.change(retainedInput, { target: { value: "" } })
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(marker).toHaveFocus()
    expect(getComputedStyle(marker).outlineStyle).toBe("none")
    fireEvent.click(picker)
    expect(screen.queryByRole("button", { name: threadCopy.point(1) })).not.toBeInTheDocument()
    fireEvent.click(picker)
    await waitFor(() => expect(picker).toHaveAttribute("aria-pressed", "true"))
    expect(screen.getByRole("button", { name: threadCopy.point(1) })).toBeVisible()
    receive(frame, { type: "replica:canvas:resolved", results: [] })
    expect(screen.queryByRole("button", { name: threadCopy.point(1) })).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(
        ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
      ),
    ).toBe(false)
    view.unmount()
  })

  it("reports a note-loading failure outside the comments sidebar", async () => {
    const { fetch } = savedNotesFixture()
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes" && !options?.method
        ? Promise.resolve(Response.json({ error: "Note storage is unavailable." }, { status: 503 }))
        : original(path, options),
    )
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const notifications = await screen.findByRole("region", { name: "Comment notifications" })
    expect(within(notifications).getByRole("alert")).toHaveTextContent(
      "Note storage is unavailable.",
    )
    fireEvent.click(screen.getByRole("button", { name: copy.openNotes(0) }))
    const sidebar = screen.getByRole("complementary", { name: copy.notes })
    expect(sidebar).not.toContainElement(notifications)
    expect(within(sidebar).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Note storage is unavailable.")).not.toBeInTheDocument()
  })

  it("reports a failed follow-up externally without discarding the draft or changing the thread", async () => {
    const { fetch, saved } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      localId: "original",
      kind: "improvement_note",
      author: "local",
      body: "Original feedback.",
      route: "/settings",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      thread: { originalStatus: "open", messages: [] },
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "open",
      sync: "local",
      revision: 1,
    })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((path, options) =>
      path === "/api/improvement-notes" && options?.method === "POST"
        ? Promise.resolve(
            Response.json({ error: "Follow-up could not be saved." }, { status: 503 }),
          )
        : original(path, options),
    )
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    fireEvent.click(await screen.findByRole("button", { name: copy.openNotes(1) }))
    fireEvent.click(await screen.findByRole("button", { name: "Open note: Original feedback." }))
    const dialog = screen.getByRole("dialog", { name: "Save" })
    const conversation = within(dialog)
    fireEvent.change(conversation.getByRole("textbox", { name: threadCopy.comments.replyLabel }), {
      target: { value: "Keep this follow-up draft." },
    })
    fireEvent.click(
      conversation.getByRole("button", { name: threadCopy.comments.replySubmitLabel }),
    )
    const notifications = await screen.findByRole("region", { name: "Comment notifications" })
    expect(within(notifications).getByRole("alert")).toHaveTextContent(
      "Follow-up could not be saved.",
    )
    expect(dialog).not.toContainElement(notifications)
    expect(conversation.queryByRole("alert")).not.toBeInTheDocument()
    expect(conversation.queryByText("Follow-up could not be saved.")).not.toBeInTheDocument()
    expect(conversation.getByRole("textbox", { name: threadCopy.comments.replyLabel })).toHaveValue(
      "Keep this follow-up draft.",
    )
    expect(saved.notes[0]?.thread.messages).toHaveLength(0)
  })

  it.each([
    ["Notes are saved locally until Hub discovers this branch.", false],
    ["Notes are saved locally. Connect to Hub to sync.", false],
    ["Improvements are saved locally until their captured source has a published Build.", false],
    [
      "This local improvement has no captured source. It cannot sync. Keep it locally or select its target again as a new improvement.",
      false,
    ],
    ["These notes changed in another panel. Reload before making changes.", false],
    ["This note changed while it was open. Reopen it before making changes.", false],
    ["Hub sync failed: Connection refused. Your notes remain saved locally.", true],
  ])(
    "hides local and stale-panel notices but reports genuine sync failures externally: %s",
    async (syncError, visible) => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const { saved } = savedNotesFixture()
      saved.syncError = syncError
      const view = render(
        <App
          config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }}
        />,
      )
      await waitFor(() => expect(saved.revision).toBeGreaterThan(0))
      const frame = screen.getByTitle("Demo prototype")
      if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
      receive(frame, {
        type: "replica:canvas:ready",
        protocolVersion: 1,
        improvementSelection: true,
        route: { pathname: "/", search: "", hash: "" },
      })
      await waitFor(() => expect(screen.getByRole("button", { name: copy.annotate })).toBeEnabled())
      fireEvent.click(screen.getByRole("button", { name: copy.openNotes(0) }))
      const sidebar = screen.getByRole("complementary", { name: copy.notes })
      expect(within(sidebar).queryByRole("alert")).not.toBeInTheDocument()
      if (visible) {
        const notifications = await screen.findByRole("region", { name: "Comment notifications" })
        expect(within(notifications).getByRole("alert")).toHaveTextContent(
          "Hub sync failed: Connection refused",
        )
        expect(sidebar).not.toContainElement(notifications)
        expect(within(sidebar).queryByText(/Connection refused/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Your notes remain saved locally/)).not.toBeInTheDocument()
      } else {
        expect(screen.queryByText(syncError)).not.toBeInTheDocument()
      }
      expect(saved.syncError).toBe(syncError)
      view.unmount()
    },
  )

  it("mounts sample threads instead of accessing real improvement notes only with explicit opt-in", async () => {
    const { fetch } = savedNotesFixture()
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: origin,
          token: "local",
          pickAndPolish: true,
          improvementThreadsSample: true,
        }}
      />,
    )
    await screen.findByRole("button", { name: "Open Notes" }, { timeout: 5000 })
    expect(screen.getAllByRole("button", { name: /^Open note:/ })).toHaveLength(3)
    expect(screen.queryByText(/visual experiment/i)).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path.startsWith("/api/improvement-notes"))).toBe(false)
    view.unmount()
  })

  it("keeps controls hidden for a bootstrap without Pick & polish", async () => {
    sharingFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: `${origin}/projects`, token: "local" }} />,
    )
    await waitFor(() => expect(screen.getByTitle("Demo prototype")).toBeInTheDocument())
    expect(view.container.querySelector("#canvas-improvement-controls")).toBeNull()
    expect(screen.queryByRole("group", { name: copy.title })).not.toBeInTheDocument()
    view.unmount()
  })

  it.each([undefined, "http://127.0.0.1:6789/projects"])(
    "keeps picking after Save and dispatches only when Fix all is requested with preview %s",
    async (previewUrl) => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const previewOrigin = new URL(previewUrl ?? origin).origin
      const { fetch, saved } = savedNotesFixture()
      const view = render(
        <App
          config={{
            name: "Demo",
            prototypeUrl: `${origin}/projects`,
            previewUrl,
            token: "local",
            pickAndPolish: true,
          }}
        />,
      )
      const frame = screen.getByTitle("Demo prototype")
      if (!(frame instanceof HTMLIFrameElement))
        throw new Error("Expected the live prototype iframe.")
      const controls = within(await screen.findByRole("group", { name: copy.title }))
      const annotate = controls.getByRole("button", { name: copy.annotate })
      expect(annotate).toBeDisabled()
      fireEvent.click(controls.getByRole("button", { name: copy.openNotes(0) }))
      expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()
      expect(screen.getByRole("button", { name: threadCopy.simulate(0) })).toBeDisabled()
      expect(view.container.querySelector(".canvas-review-controls")).toBeNull()
      const initialWrites = fetch.mock.calls.filter(([, options]) => options?.method === "POST")

      const ready = {
        type: "replica:canvas:ready",
        protocolVersion: 1,
        improvementSelection: true,
        route: { pathname: "/projects", search: "", hash: "" },
      }
      if (previewUrl) {
        receive(frame, ready, origin)
        expect(annotate).toBeDisabled()
      }
      receive(frame, ready)
      await waitFor(() => expect(annotate).toBeEnabled())
      const post = vi.spyOn(frame.contentWindow!, "postMessage")
      fireEvent.click(annotate)
      await waitFor(() => expect(annotate).toHaveAttribute("aria-pressed", "true"))
      expect(post).toHaveBeenCalledWith(
        { type: "replica:canvas:select", nonce, mode: "improvement" },
        previewOrigin,
      )
      expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()

      receive(frame, { type: "replica:canvas:selected", anchor }, "https://unrelated.example")
      expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()
      receive(frame, { type: "replica:canvas:selected", anchor, capturePending: true })
      const dialog = screen.getByRole("dialog", { name: copy.add })
      const composer = within(dialog)
      expect(composer.queryByRole("img")).not.toBeInTheDocument()
      expect(composer.queryByRole("status")).not.toBeInTheDocument()
      expect(composer.queryByText("/settings?tab=account#profile")).not.toBeInTheDocument()
      expect(dialog.querySelector("code")).toBeNull()
      expect(composer.queryByRole("button", { name: copy.cancel })).not.toBeInTheDocument()
      expect(composer.getByRole("button", { name: "Fix now" })).toBeDisabled()
      expect(composer.getByRole("button", { name: copy.closeComposer })).toBeEnabled()
      expect(composer.getByRole("textbox", { name: copy.label })).toHaveFocus()
      fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
        target: { value: "Clarify this action." },
      })
      expect(composer.getByRole("button", { name: copy.save })).toBeEnabled()
      receive(
        frame,
        { type: "replica:canvas:captured", anchor, captureError: true },
        "https://unrelated.example",
      )
      expect(composer.getByRole("button", { name: copy.save })).toBeEnabled()
      receive(frame, {
        type: "replica:canvas:captured",
        anchor,
        capture: "data:image/png;base64,aGVsbG8=",
      })
      expect(composer.queryByRole("img")).not.toBeInTheDocument()
      expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue(
        "Clarify this action.",
      )
      receive(frame, {
        type: "replica:canvas:selected",
        anchor: { ...anchor, accessibleName: "Late selection" },
      })
      expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue(
        "Clarify this action.",
      )
      fireEvent.click(composer.getByRole("button", { name: copy.save }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument(),
      )
      expect(annotate).toHaveAttribute("aria-pressed", "true")
      expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: /^Fix 1$/ })).toBeVisible()
      expect(fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))).toHaveLength(0)
      fireEvent.click(screen.getByRole("button", { name: copy.openNotes(1) }))
      expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()

      fireEvent.click(
        screen.getByRole("button", {
          name: "Open note: Clarify this action.",
        }),
      )
      expect(screen.getByTitle("Demo prototype")).toHaveAttribute(
        "src",
        `${previewOrigin}/settings?tab=account#profile`,
      )
      expect(screen.getByDisplayValue(`${origin}/settings?tab=account#profile`)).toBeInTheDocument()
      receive(frame, { ...ready, route: anchor.route })
      receive(frame, {
        type: "replica:canvas:resolved",
        results: [{ id: 1, x: 80, y: 50 }],
      })
      expect(screen.getByRole("button", { name: "Open note 1" })).toBeVisible()
      expect(screen.getAllByText("Clarify this action.")).toHaveLength(2)
      fireEvent.click(screen.getByRole("button", { name: threadCopy.back }))
      expect(
        controls.queryByRole("button", { name: threadCopy.simulate(1) }),
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: threadCopy.simulate(1) }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: threadCopy.simulate(0) })).toBeDisabled(),
      )
      const writes = fetch.mock.calls
        .filter(([, options]) => options?.method === "POST")
        .slice(initialWrites.length)
      expect(writes.map(([path]) => path)).toEqual([
        "/api/improvement-notes/capture",
        "/api/improvement-notes",
        "/api/improvement-notes/capture",
        "/api/improvement-notes/fix",
      ])
      const savedBody = writes.find(([path]) => path === "/api/improvement-notes")?.[1]?.body
      if (typeof savedBody !== "string") throw new Error("Expected a serialized improvement.")
      expect(JSON.parse(savedBody)).toMatchObject({ sourceId: "selected-source", anchor })
      expect(saved.notes[0]).toMatchObject({ anchor, body: "Clarify this action." })
      expect(saved.notes[0]).not.toHaveProperty("capture")
      view.unmount()
    },
  )

  it("shows the same pending request count as Fix all only while picking and hides it at zero", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    await fetch("/api/improvement-notes", {
      method: "POST",
      body: JSON.stringify({ anchor, body: "Original request" }),
    })
    saved.notes[0]!.thread.messages.push(
      { id: "follow-up-1", role: "author", body: "First follow-up", status: "open" },
      { id: "follow-up-2", role: "author", body: "Second follow-up", status: "open" },
      { id: "history", role: "author", body: "Already handled", status: "ready" },
      { id: "answer", role: "copilot", body: "Earlier result", status: "ready", requestIds: [] },
    )
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    expect(screen.queryByRole("button", { name: /^Fix \d+$/ })).not.toBeInTheDocument()
    fireEvent.click(picker)
    const pill = await screen.findByRole("button", { name: "Fix 3" })
    expect(pill).toBeEnabled()
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    fireEvent.click(picker)
    expect(screen.queryByRole("button", { name: /^Fix \d+$/ })).not.toBeInTheDocument()
    fireEvent.click(picker)
    await screen.findByRole("button", { name: "Fix 3" })
    fireEvent.click(screen.getByRole("button", { name: copy.openNotes(1) }))
    expect(screen.getByRole("button", { name: threadCopy.simulate(3) })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: copy.closeNotes(1) }))
    fireEvent.click(screen.getByRole("button", { name: "Fix 3" }))
    await waitFor(() => expect(saved.activeBatch).toBe("batch"))
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Fix \d+$/ })).not.toBeInTheDocument(),
    )
    expect(picker).toHaveAttribute("aria-pressed", "true")
    const fix = fetch.mock.calls.find(([path]) => path.endsWith("/fix"))
    const body = fix?.[1]?.body
    if (typeof body !== "string") throw new Error("Expected a serialized Fix all request.")
    expect(JSON.parse(body)).toMatchObject({
      scope: "all",
      noteIds: [{ id: 1, revision: 1 }],
    })
    expect(saved.notes[0]?.thread.messages.filter((entry) => entry.status === "open")).toEqual([])
  })

  it("keeps fix controls enabled while a fix is in flight and queues later fixes in click order", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture()
    await fetch("/api/improvement-notes", {
      method: "POST",
      body: JSON.stringify({ anchor, body: "Existing request" }),
    })
    let releaseFix: (() => void) | undefined
    const pendingFix = new Promise<void>((resolve) => {
      releaseFix = resolve
    })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation(async (path, options) => {
      if (path.endsWith("/fix")) await pendingFix
      return original(path, options)
    })
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    fireEvent.click(picker)
    const pill = await screen.findByRole("button", { name: "Fix 1" })
    fireEvent.click(pill)
    function mutations(): [string, Record<string, unknown>][] {
      return fetch.mock.calls
        .filter(
          ([path, options]) =>
            options?.method === "POST" &&
            (path === "/api/improvement-notes" || path.endsWith("/fix")),
        )
        .map(([path, options]) => {
          const body = options?.body
          if (typeof body !== "string") throw new Error("Expected a serialized mutation.")
          return [path, JSON.parse(body) as Record<string, unknown>]
        })
    }
    await waitFor(() => expect(mutations()).toHaveLength(2))
    expect(pill).toBeEnabled()
    fireEvent.click(pill)

    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Queued request" },
    })
    const fixNow = composer.getByRole("button", { name: "Fix now" })
    expect(fixNow).toBeEnabled()
    fireEvent.click(fixNow)
    expect(mutations()).toHaveLength(2)

    act(() => releaseFix?.())
    await waitFor(() => expect(saved.notes[1]?.status).toBe("sent"))
    const sent = mutations().slice(1)
    expect(sent).toHaveLength(3)
    expect(sent[0]?.[0]).toMatch(/\/fix$/)
    expect(sent[0]?.[1]).toMatchObject({ scope: "all", noteIds: [{ id: 1, revision: 1 }] })
    expect(sent[1]?.[1]).toMatchObject({ body: "Queued request" })
    expect(sent[2]?.[0]).toMatch(/\/fix$/)
    expect(sent[2]?.[1]).toMatchObject({ noteIds: [{ id: 2, revision: 1 }] })
    expect(saved.notes[0]?.status).toBe("sent")
  })

  it.each([false, true])(
    "Fix now saves and targets only the new note, keeping the sidebar closed when dispatch fails: %s",
    async (fixFails) => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const { fetch, saved } = savedNotesFixture()
      await fetch("/api/improvement-notes", {
        method: "POST",
        body: JSON.stringify({ anchor, body: "Existing request" }),
      })
      const untouched = structuredClone(saved.notes[0])
      const original = fetch.getMockImplementation()!
      fetch.mockImplementation((path, options) =>
        fixFails && path.endsWith("/fix")
          ? Promise.resolve(Response.json({ error: "Fix could not start." }, { status: 409 }))
          : original(path, options),
      )
      render(
        <App
          config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }}
        />,
      )
      const frame = screen.getByTitle("Demo prototype")
      if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
      const picker = await screen.findByRole("button", { name: copy.annotate })
      receive(frame, {
        type: "replica:canvas:ready",
        protocolVersion: 1,
        improvementSelection: true,
        route: anchor.route,
      })
      await waitFor(() => expect(picker).toBeEnabled())
      fireEvent.click(picker)
      receive(frame, { type: "replica:canvas:selected", anchor })
      const composer = within(await screen.findByRole("dialog", { name: copy.add }))
      fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
        target: { value: "Only fix this new request" },
      })
      fireEvent.click(composer.getByRole("button", { name: "Fix now" }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument(),
      )
      expect(saved.notes).toHaveLength(2)
      expect(saved.notes[0]).toEqual(untouched)
      expect(saved.notes[1]).toMatchObject({
        body: "Only fix this new request",
        status: fixFails ? "open" : "sent",
      })
      expect(picker).toHaveAttribute("aria-pressed", "false")
      expect(screen.queryByRole("complementary", { name: copy.notes })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /^Fix \d+$/ })).not.toBeInTheDocument()
      const fixes = fetch.mock.calls.filter(([path]) => path.endsWith("/fix"))
      expect(fixes).toHaveLength(1)
      const body = fixes[0]?.[1]?.body
      if (typeof body !== "string") throw new Error("Expected a serialized scoped fix.")
      expect(JSON.parse(body)).toMatchObject({
        identity: saved.identity,
        noteIds: [{ id: 2, revision: 1 }],
      })
      if (fixFails) {
        const notifications = await screen.findByRole("region", { name: "Comment notifications" })
        expect(within(notifications).getByRole("alert")).toHaveTextContent("Fix could not start.")
        fireEvent.click(screen.getByRole("button", { name: copy.openNotes(2) }))
        expect(screen.getByRole("button", { name: threadCopy.simulate(2) })).toBeEnabled()
      }
    },
  )

  it("allows a local save after source capture fails without a local-only composer notice", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch, saved } = savedNotesFixture(true)
    render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    const picker = await screen.findByRole("button", { name: copy.annotate })
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    fireEvent.click(picker)
    await waitFor(() => expect(picker).toHaveAttribute("aria-pressed", "true"))
    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(screen.getByRole("dialog", { name: copy.add }))
    const form = composer.getByRole("textbox", { name: copy.label }).closest("form")
    if (!form) throw new Error("Expected the improvement composer form.")
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText(copy.sourceUnavailable)).not.toBeInTheDocument()
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Keep this private local request" },
    })
    fireEvent.click(composer.getByRole("button", { name: copy.save }))
    await waitFor(() => expect(saved.notes).toHaveLength(1))
    const write = fetch.mock.calls.find(
      ([path, options]) => path === "/api/improvement-notes" && options?.method === "POST",
    )
    if (typeof write?.[1]?.body !== "string") throw new Error("Expected a local save.")
    expect(JSON.parse(write[1].body)).not.toHaveProperty("sourceId")
  })

  it("keeps follow-up drafts while polling and protects a deletion against later revisions", async () => {
    vi.useFakeTimers()
    const { saved, fetch } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      localId: "original",
      kind: "improvement_note",
      author: "local",
      body: "Original feedback.",
      route: "/settings",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      thread: { originalStatus: "open", messages: [] },
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "open",
      sync: "local",
      revision: 1,
    })
    const toolbarTarget = document.createElement("div")
    document.body.append(toolbarTarget)
    const view = render(
      <ImprovementNotesPrototype
        canvas={{
          token: "local",
          frameRef: { current: null },
          toolbarTarget,
          prototypeUrl: origin,
          hubOpen: false,
          onOpenNotes: vi.fn(),
          onNavigate: vi.fn(),
        }}
      />,
    )
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.click(screen.getByRole("button", { name: copy.openNotes(1) }))
      expect(screen.queryByRole("button", { name: "Note actions: 1" })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: `${threadCopy.delete}: 1` })).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Open note: Original feedback." }))
      fireEvent.change(screen.getByRole("textbox", { name: threadCopy.comments.replyLabel }), {
        target: { value: "Older unsaved draft." },
      })
      const serverNote = saved.notes[0]
      if (!serverNote) throw new Error("Expected the saved test note.")
      serverNote.thread = {
        originalStatus: "open",
        messages: [
          { id: "other", role: "author", body: "Another panel's request.", status: "open" },
        ],
      }
      serverNote.revision = 2
      saved.revision++
      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(screen.getByRole("textbox", { name: threadCopy.comments.replyLabel })).toHaveValue(
        "Older unsaved draft.",
      )
      fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.replySubmitLabel }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(serverNote.body).toBe("Original feedback.")
      expect(serverNote.thread.messages.map((entry) => entry.body)).toEqual([
        "Another panel's request.",
        "Older unsaved draft.",
      ])
      expect(fetch.mock.calls.at(-1)?.[1]?.body).toContain('"expectedNoteRevision":2')
      fireEvent.click(screen.getByRole("button", { name: threadCopy.back }))
      fireEvent.click(screen.getByRole("button", { name: `${threadCopy.delete}: 1` }))
      serverNote.revision = 4
      saved.revision++
      await act(() => vi.advanceTimersByTimeAsync(3000))
      const confirmation = within(screen.getByRole("dialog", { name: threadCopy.deleteTitle }))
      fireEvent.click(confirmation.getByRole("button", { name: threadCopy.delete }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(saved.notes).toHaveLength(1)
      expect(fetch.mock.calls.at(-1)?.[1]?.body).toContain('"expectedNoteRevision":3')
    } finally {
      view.unmount()
      toolbarTarget.remove()
      vi.useRealTimers()
    }
  })
  it("preserves a follow-up draft and the original request when a ready answer arrives", async () => {
    vi.useFakeTimers()
    const { saved, fetch } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      localId: "original",
      kind: "improvement_note",
      author: "local",
      body: "Original feedback.",
      route: "/settings",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      thread: { originalStatus: "sent", messages: [] },
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "sent",
      sync: "local",
      revision: 1,
    })
    const toolbarTarget = document.createElement("div")
    document.body.append(toolbarTarget)
    const view = render(
      <ImprovementNotesPrototype
        canvas={{
          token: "local",
          frameRef: { current: null },
          toolbarTarget,
          prototypeUrl: origin,
          hubOpen: false,
          onOpenNotes: vi.fn(),
          onNavigate: vi.fn(),
        }}
      />,
    )
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.click(screen.getByRole("button", { name: copy.openNotes(1) }))
      fireEvent.click(screen.getByRole("button", { name: "Open note: Original feedback." }))
      fireEvent.change(screen.getByRole("textbox", { name: threadCopy.comments.replyLabel }), {
        target: { value: "Unsaved request." },
      })
      const note = saved.notes[0]!
      note.status = "ready"
      const answer = "Implemented the requested change.\nReview the updated control."
      note.thread = {
        originalStatus: "ready",
        messages: [
          {
            id: "answer",
            role: "copilot",
            body: answer,
            status: "ready",
            requestIds: ["original"],
          },
        ],
      }
      note.revision++
      saved.revision++
      await act(() => vi.advanceTimersByTimeAsync(3000))
      const textbox = screen.getByRole("textbox", { name: threadCopy.comments.replyLabel })
      expect(textbox).not.toHaveAttribute("readonly")
      expect(textbox).toHaveValue("Unsaved request.")
      expect(screen.getByRole("button", { name: threadCopy.resolve })).toBeDisabled()
      fetch.mockClear()
      fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.replySubmitLabel }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(fetch).toHaveBeenCalled()
      expect(note.body).toBe("Original feedback.")
      expect(note.status).toBe("open")
      expect(note.thread.messages.map((entry) => entry.body)).toEqual([answer, "Unsaved request."])
      const conversation = screen.getByRole("dialog", { name: "Save" })
      expect(
        conversation.querySelector(
          ".review-thread-message:nth-child(2) .review-thread-message__body",
        )?.textContent,
      ).toBe(answer)
      expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()
    } finally {
      view.unmount()
      toolbarTarget.remove()
      vi.useRealTimers()
    }
  })

  it("keeps an older bridge disabled instead of pretending combined selection works", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    savedNotesFixture()
    const view = render(
      <App
        config={{
          name: "Demo",
          prototypeUrl: `${origin}/projects`,
          token: "local",
          pickAndPolish: true,
        }}
      />,
    )
    const controls = within(await screen.findByRole("group", { name: copy.title }))
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement))
      throw new Error("Expected the live prototype iframe.")
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      route: { pathname: "/projects", search: "", hash: "" },
    })
    expect(controls.getByRole("button", { name: copy.annotate })).toBeDisabled()
    const notifications = await screen.findByRole("region", { name: "Comment notifications" })
    expect(within(notifications).getByRole("alert")).toHaveTextContent(copy.bridgeUnavailable)
    fireEvent.click(screen.getByRole("button", { name: copy.openNotes(0) }))
    expect(
      within(screen.getByRole("complementary", { name: copy.notes })).queryByText(
        copy.bridgeUnavailable,
      ),
    ).not.toBeInTheDocument()
    view.unmount()
  })
})
