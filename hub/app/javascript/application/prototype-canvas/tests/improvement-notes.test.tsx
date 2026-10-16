import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { copy } from "@features/prototype-canvas-improvement-notes/en"
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

function savedNotesFixture() {
  const { fetch } = sharingFixture()
  const original = fetch.getMockImplementation()!
  const saved = {
    identity: "notes",
    revision: 0,
    notes: [] as Note[],
    syncError: null,
    activeBatch: null as string | null,
  }
  fetch.mockImplementation(async (path, options) => {
    if (!path.startsWith("/api/improvement-notes")) return original(path, options)
    if (options?.method === "POST") {
      if (typeof options.body !== "string") throw new Error("Expected a JSON notes request.")
      const input: unknown = JSON.parse(options.body)
      if (path.endsWith("/fix")) {
        saved.activeBatch = "batch"
        saved.notes.forEach((note) => {
          note.status = "sent"
        })
      } else if (!path.endsWith("/sync")) {
        if (!input || typeof input !== "object") throw new Error("Expected a notes request.")
        if ("operation" in input && (input.operation === "edit" || input.operation === "delete")) {
          const note = saved.notes.find((item) => "id" in input && item.id === input.id)
          if (
            !note ||
            !("expectedNoteRevision" in input) ||
            note.revision !== input.expectedNoteRevision
          )
            return Response.json({ error: "This note changed while it was open." }, { status: 409 })
          if (input.operation === "delete")
            saved.notes = saved.notes.filter((item) => item !== note)
          else {
            if (!("body" in input) || typeof input.body !== "string")
              throw new Error("Expected the edited note body.")
            note.body = input.body
            note.revision++
          }
          saved.revision++
          return Response.json(saved)
        }
        if (!("anchor" in input) || !("body" in input) || typeof input.body !== "string")
          throw new Error("Expected a note and its anchor.")
        const selected = REVIEW_ANCHOR_SCHEMA.parse(input.anchor)
        saved.notes.push({
          anchor: selected,
          body: input.body,
          capture: "capture" in input && typeof input.capture === "string" ? input.capture : "",
          id: saved.notes.length + 1,
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
      expect(screen.getByRole("complementary", { name: copy.notes })).toHaveClass("hub-sidebar")
      expect(screen.queryByText(copy.demo)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.canvasDemoNotice)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.owner)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.authorContext)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.syncControls)).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: copy.fixAll(0) })).toBeDisabled()
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
      expect(composer.queryByText(anchor.accessibleName, { exact: true })).not.toBeInTheDocument()
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

      fireEvent.click(screen.getByRole("button", { name: "View target: Save" }))
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
      expect(screen.getByRole("button", { name: "Open improvement note 1: Save" })).toHaveStyle({
        left: "80px",
        top: "50px",
      })
      expect(screen.getByText("Clarify this action.")).toBeVisible()
      expect(controls.queryByRole("button", { name: copy.fixAll(1) })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: copy.fixAll(1) }))
      expect(screen.queryByRole("dialog", { name: copy.handoff })).not.toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole("button", { name: copy.fixAll(0) })).toBeDisabled(),
      )
      const writes = fetch.mock.calls
        .filter(([, options]) => options?.method === "POST")
        .slice(initialWrites.length)
      expect(writes.map(([path]) => path)).toEqual([
        "/api/improvement-notes",
        "/api/improvement-notes/fix",
      ])
      expect(saved.notes[0]).toMatchObject({ capture: "", anchor, body: "Clarify this action." })
      view.unmount()
    },
  )

  it("preserves images already stored with saved notes", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    const { saved } = savedNotesFixture()
    const capture = "data:image/png;base64,aGVsbG8="
    saved.notes.push({
      id: 1,
      kind: "improvement_note",
      author: "local",
      body: "Previously saved note.",
      route: "/settings?tab=account#profile",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      capture,
      anchor: REVIEW_ANCHOR_SCHEMA.parse(anchor),
      status: "open",
      sync: "local",
      revision: 1,
    })
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
    expect(await screen.findByRole("img", { name: `${copy.capture}: Save` })).toHaveAttribute(
      "src",
      capture,
    )
    expect(saved.notes[0]).toMatchObject({ capture })
    const frame = screen.getByTitle("Demo prototype")
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("Expected the preview frame.")
    receive(frame, {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      improvementSelection: true,
      route: anchor.route,
    })
    receive(frame, {
      type: "replica:canvas:resolved",
      results: [{ id: 1, x: 80, y: 50 }],
    })
    expect(
      await screen.findByRole("button", { name: "Open improvement note 1: Save" }),
    ).toHaveStyle({
      left: "80px",
      top: "50px",
    })
    view.unmount()
  })

  it("keeps an edit bound to its opened note revision while another panel updates it", async () => {
    vi.useFakeTimers()
    const { saved, fetch } = savedNotesFixture()
    saved.notes.push({
      id: 1,
      kind: "improvement_note",
      author: "local",
      body: "Original feedback.",
      route: "/settings",
      target: "Save",
      selector: "#save",
      rect: anchor.rect,
      capture: "",
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
          prototypeUrl: origin,
          branch: "prototype/demo",
          hubOpen: false,
          onOpenNotes: vi.fn(),
          onNavigate: vi.fn(),
        }}
      />,
    )
    try {
      await act(() => vi.advanceTimersByTimeAsync(0))
      fireEvent.click(screen.getByRole("button", { name: copy.editAction }))
      fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
        target: { value: "Older unsaved draft." },
      })
      const serverNote = saved.notes[0]
      if (!serverNote) throw new Error("Expected the saved test note.")
      serverNote.body = "Another panel's edit."
      serverNote.revision = 2
      saved.revision++
      await act(() => vi.advanceTimersByTimeAsync(3000))
      fireEvent.click(screen.getByRole("button", { name: copy.saveEdit }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByRole("alert")).toHaveTextContent("This note changed while it was open.")
      expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("Older unsaved draft.")
      expect(serverNote.body).toBe("Another panel's edit.")
      expect(fetch.mock.calls.at(-1)?.[1]?.body).toContain('"expectedNoteRevision":1')
      fireEvent.click(screen.getByRole("button", { name: copy.closeComposer }))
      fireEvent.click(screen.getByRole("button", { name: copy.discard }))
      fireEvent.click(screen.getByRole("button", { name: copy.deleteAction }))
      serverNote.revision = 3
      saved.revision++
      await act(() => vi.advanceTimersByTimeAsync(3000))
      const confirmation = within(screen.getByRole("dialog", { name: copy.deleteTitle }))
      fireEvent.click(confirmation.getByRole("button", { name: copy.deleteAction }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(saved.notes).toHaveLength(1)
      expect(fetch.mock.calls.at(-1)?.[1]?.body).toContain('"expectedNoteRevision":2')
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
          improvementNotesDemo: true,
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
