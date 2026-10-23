import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { copy } from "@features/prototype-canvas-improvement-notes/en"
import { copy as threadCopy } from "@features/prototype-canvas-improvement-threads/en"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."
import type { Note } from "@features/prototype-canvas-improvement-notes/types"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { ImprovementNotesPrototype } from "@features/prototype-canvas-improvement-notes"

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
        saved.activeBatch = "batch"
        saved.notes.forEach((note) => {
          note.status = "sent"
          note.thread.originalStatus = "sent"
          for (const message of note.thread.messages)
            if (message.role === "author" && message.status === "open") message.status = "sent"
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

  it("leaves typing, modified keys and already handled host events untouched", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { fetch } = savedNotesFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
    )
    const picker = await screen.findByRole("button", { name: copy.annotate })
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the prototype iframe.")
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
    ]) {
      const event = new KeyboardEvent("keydown", { key: "s", cancelable: true, ...options })
      fireEvent(window, event)
      expect(event.defaultPrevented).toBe(false)
    }
    const handled = new KeyboardEvent("keydown", { key: "s", cancelable: true })
    handled.preventDefault()
    fireEvent(window, handled)
    const targets = document.createElement("div")
    targets.innerHTML = `
      <input /><textarea></textarea><select><option>Value</option></select>
      <div role="textbox"><span></span></div>
      <div role="combobox"><span></span></div>
      <div contenteditable="true"><span></span></div>
      <dialog open><button></button></dialog>
      <div role="dialog"><button></button></div>
      <div role="menu"><button></button></div>
    `
    document.body.append(targets)
    for (const target of targets.querySelectorAll("input, textarea, select, span, button")) {
      const event = new KeyboardEvent("keydown", {
        key: "s",
        bubbles: true,
        cancelable: true,
      })
      fireEvent(target, event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(picker).toHaveAttribute("aria-pressed", "false")
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(0)
    targets.remove()
    view.unmount()
  })

  it("accepts selection-toggle requests only from the current authenticated preview", async () => {
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
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "replica:canvas:request-ready",
        nonce,
        selectionShortcut: true,
      }),
      new URL(frame.src).origin,
    )
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    await waitFor(() => expect(picker).toBeEnabled())
    const toggle = { type: "replica:canvas:selection-toggle-requested", nonce }
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
    await act(async () => {
      finishCapture(Response.json({ identity: saved.identity, sourceId: "early-target-source" }))
      await capture
    })
    const composer = within(await screen.findByRole("dialog", { name: copy.add }))
    const note = composer.getByRole("textbox", { name: copy.label })
    const save = composer.getByRole("button", { name: copy.save })
    expect(save).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter")
    expect(within(save).getByText(copy.saveShortcutMac)).toBeVisible()
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
    view.unmount()
  })

  it.each(["toolbar", "preview"] as const)(
    "ignores a pending capture cancelled through the %s and retains the next selection's source",
    async (cancellation) => {
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
      fireEvent.click(picker)
      expect(picker).toHaveAttribute("aria-pressed", "true")
      expect(picker).toBeEnabled()
      expect(captures).toHaveLength(1)
      receive(frame, { type: "replica:canvas:selected", anchor })

      if (cancellation === "toolbar") fireEvent.click(picker)
      else receive(frame, { type: "replica:canvas:selection-cancelled", reason: "escape" })
      expect(picker).toHaveAttribute("aria-pressed", "false")
      await act(async () => {
        captures[0]!(Response.json({ identity: saved.identity, sourceId: "cancelled-source" }))
        await Promise.resolve()
      })
      expect(picker).toHaveAttribute("aria-pressed", "false")
      expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()
      receive(frame, { type: "replica:canvas:selected", anchor })
      expect(screen.queryByRole("dialog", { name: copy.add })).not.toBeInTheDocument()

      fireEvent.click(picker)
      expect(captures).toHaveLength(2)
      const nextAnchor = { ...anchor, selector: "#next", accessibleName: "Next" }
      receive(frame, { type: "replica:canvas:selected", anchor: nextAnchor })
      await act(async () => {
        captures[1]!(Response.json({ identity: saved.identity, sourceId: "next-selection-source" }))
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
      if (typeof write?.[1]?.body !== "string")
        throw new Error("Expected a serialized improvement.")
      expect(JSON.parse(write[1].body)).toMatchObject({
        identity: saved.identity,
        sourceId: "next-selection-source",
        anchor: nextAnchor,
      })
      view.unmount()
    },
  )

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
    const card = await screen.findByRole("button", {
      name: "Open improvement: Make the save action clearer.",
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
    expect(screen.getByRole("dialog", { name: threadCopy.conversation })).toBeVisible()
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: new URL(frame.src).origin,
          data: dismiss,
        }),
      )
    })
    expect(screen.getByRole("dialog", { name: threadCopy.conversation })).toBeVisible()
    receive(frame, { ...dismiss, nonce: staleNonce })
    expect(screen.getByRole("dialog", { name: threadCopy.conversation })).toBeVisible()
    receive(frame, dismiss)
    expect(screen.queryByRole("dialog", { name: threadCopy.conversation })).not.toBeInTheDocument()
    expect(card).toHaveFocus()

    fireEvent.click(card)
    receive(frame, { ...dismiss, restoreFocus: false })
    expect(screen.queryByRole("dialog", { name: threadCopy.conversation })).not.toBeInTheDocument()
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
    receive(frame, dismiss)
    fireEvent.click(screen.getByRole("button", { name: threadCopy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: threadCopy.conversation })).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    view.unmount()
  })

  it("keeps a failed save visible in the composer with the draft intact", async () => {
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
    await waitFor(() => expect(annotate).toHaveAttribute("aria-pressed", "true"))
    receive(frame, { type: "replica:canvas:selected", anchor })
    const composer = within(screen.getByRole("dialog", { name: copy.add }))
    fireEvent.change(composer.getByRole("textbox", { name: copy.label }), {
      target: { value: "Keep the save action visible." },
    })
    fireEvent.click(composer.getByRole("button", { name: copy.save }))
    const alert = await composer.findByRole("alert")
    expect(alert).toBeVisible()
    expect(alert).toHaveTextContent("Notes could not be saved.")
    expect(composer.getByRole("textbox", { name: copy.label })).toHaveValue(
      "Keep the save action visible.",
    )
    expect(saved.notes).toHaveLength(0)
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
    await screen.findByRole("button", {
      name: "Open improvement: Make the save action clearer.",
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
    const dialog = screen.getByRole("dialog", { name: threadCopy.conversation })
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
    fireEvent.click(within(dialog).getByRole("button", { name: threadCopy.back }))
    expect(marker).toHaveFocus()
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

  it.each([
    ["Notes are saved locally until Hub discovers this branch.", false],
    ["Hub sync failed: Connection refused. Your notes remain saved locally.", true],
  ])("only hides the informational branch-discovery notice: %s", async (syncError, visible) => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { saved } = savedNotesFixture()
    saved.syncError = syncError
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: origin, token: "local", pickAndPolish: true }} />,
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
    if (visible) {
      const alert = await screen.findByText(syncError)
      expect(alert).toHaveAttribute("role", "alert")
    } else {
      expect(screen.queryByText(syncError)).not.toBeInTheDocument()
    }
    expect(saved.syncError).toBe(syncError)
    view.unmount()
  })

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
    await screen.findByRole("button", { name: "Open improvements" }, { timeout: 5000 })
    expect(screen.getAllByRole("button", { name: /^Open improvement:/ })).toHaveLength(3)
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
    "saves real local notes and dispatches only through Fix all with preview %s",
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
      expect(composer.getAllByRole("button")).toHaveLength(2)
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
        expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible(),
      )

      fireEvent.click(
        screen.getByRole("button", {
          name: "Open improvement: Clarify this action.",
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
      expect(screen.getByRole("button", { name: "Open improvement 1" })).toBeVisible()
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

  it("explains capture failure while still allowing an improvement to be saved privately", async () => {
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
    expect(composer.getByRole("alert")).toHaveTextContent(copy.sourceUnavailable)
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
    const view = render(
      <ImprovementNotesPrototype
        canvas={{
          token: "local",
          frameRef: { current: null },
          toolbarTarget: null,
          prototypeUrl: origin,
          hubOpen: false,
          onOpenNotes: vi.fn(),
          onNavigate: vi.fn(),
        }}
      />,
    )
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
      expect(screen.queryByRole("menuitem", { name: copy.editAction })).not.toBeInTheDocument()
      expect(screen.queryByRole("menuitem", { name: "Add follow-up" })).not.toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole("menuitem", { name: threadCopy.delete }), {
        key: "Escape",
      })
      fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original feedback." }))
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
      fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
      fireEvent.click(screen.getByRole("menuitem", { name: threadCopy.delete }))
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
    const view = render(
      <ImprovementNotesPrototype
        canvas={{
          token: "local",
          frameRef: { current: null },
          toolbarTarget: null,
          prototypeUrl: origin,
          hubOpen: false,
          onOpenNotes: vi.fn(),
          onNavigate: vi.fn(),
        }}
      />,
    )
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original feedback." }))
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
      const conversation = screen.getByRole("dialog", { name: threadCopy.conversation })
      expect(
        conversation.querySelector(
          ".review-thread-message:nth-child(2) .review-thread-message__body",
        )?.textContent,
      ).toBe(answer)
      expect(screen.getByRole("complementary", { name: copy.notes })).toBeVisible()
    } finally {
      view.unmount()
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
    expect(
      screen
        .getAllByText(copy.bridgeUnavailable)
        .some((element) => element.closest(".hub-sidebar")),
    ).toBe(true)
    view.unmount()
  })
})
