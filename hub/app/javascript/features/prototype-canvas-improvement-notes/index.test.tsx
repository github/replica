import { fireEvent, render, screen, within } from "@testing-library/react"

import { ImprovementNotesPrototype } from "."
import { copy } from "./en"
import { sampleNotes, targets } from "./fixtures"

function addNote(body: string, target = "new-project") {
  const annotate = within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
    name: copy.annotate,
  })
  if (annotate.getAttribute("aria-pressed") !== "true") {
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
  }
  const selected = targets.find((item) => item.id === target)
  if (!selected) throw new Error(`Unknown sample target: ${target}`)
  fireEvent.click(screen.getByRole("button", { name: selected.label }))
  fireEvent.change(screen.getByRole("textbox", { name: copy.label }), { target: { value: body } })
  fireEvent.click(screen.getByRole("button", { name: copy.save }))
}

function pointerStage() {
  class DemoPointerEvent extends MouseEvent {
    pointerId: number
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options)
      this.pointerId = options.pointerId ?? 1
    }
  }
  vi.stubGlobal("PointerEvent", DemoPointerEvent)
  const stage = screen.getByLabelText("Selectable preview")
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 960, 560))
  stage.setPointerCapture = vi.fn()
  stage.releasePointerCapture = vi.fn()
  return stage
}

function fixAll(count: number) {
  if (!screen.queryByRole("complementary", { name: copy.notes })) {
    fireEvent.click(screen.getByRole("button", { name: /Open improvement notes/ }))
  }
  selectFilter(copy.allActive)
  return screen.getByRole("button", { name: copy.fixAll(count) })
}

function selectFilter(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${copy.filter}:`) }))
  fireEvent.click(screen.getByRole("menuitemradio", { name: label }))
}

describe("ImprovementNotesPrototype()", () => {
  it("opens notes from the toolbar counter and fixes eligible notes only from the active sidebar", () => {
    render(<ImprovementNotesPrototype initial="multiple" />)
    const toolbar = within(screen.getByRole("group", { name: copy.title }))
    expect(toolbar.getByRole("button", { name: copy.annotate })).toBeVisible()
    const counter = toolbar.getByRole("button", { name: copy.openNotes(3) })
    expect(counter).toHaveTextContent("3")
    expect(counter.querySelector("svg")).toBeNull()
    expect(toolbar.getAllByRole("button")).toHaveLength(2)
    expect(toolbar.queryByRole("button", { name: /Fix/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Improvement notes (3)" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: copy.closeNotes }))
    fireEvent.click(counter)
    expect(counter).toHaveAttribute("aria-expanded", "true")
    const sidebar = within(screen.getByRole("complementary", { name: copy.notes }))
    expect(sidebar.getByRole("button", { name: copy.fixAll(2) })).toBeEnabled()
    for (const label of [copy.readyFilter, copy.resolvedFilter]) {
      selectFilter(label)
      expect(sidebar.queryByRole("button", { name: /Fix all/ })).not.toBeInTheDocument()
    }
    selectFilter(copy.allActive)
    fireEvent.click(sidebar.getByRole("button", { name: copy.fixAll(2) }))
    const handoff = within(screen.getByRole("dialog", { name: copy.handoff }))
    for (const note of sampleNotes) {
      if (note.status === "open") expect(handoff.getByText(note.body)).toBeVisible()
      else expect(handoff.queryByText(note.body)).not.toBeInTheDocument()
    }
  })

  it("labels the simulation and disables Fix until a note is saved", () => {
    render(<ImprovementNotesPrototype />)
    expect(screen.getByText(copy.demoNotice)).toBeVisible()
    expect(fixAll(0)).toBeDisabled()
    addNote("Make the action easier to find.")
    expect(fixAll(1)).toBeEnabled()
    expect(screen.getByText("Make the action easier to find.")).toBeVisible()
    expect(
      screen.getByRole("img", { name: "Captured target: New project button" }),
    ).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"))
  })

  it("hides even the disabled Fix all button outside Active notes", () => {
    render(<ImprovementNotesPrototype />)
    expect(screen.getByRole("button", { name: copy.fixAll(0) })).toBeDisabled()
    for (const label of [copy.readyFilter, copy.resolvedFilter]) {
      selectFilter(label)
      expect(screen.queryByRole("button", { name: /Fix all/ })).not.toBeInTheDocument()
    }
    selectFilter(copy.allActive)
    expect(screen.getByRole("button", { name: copy.fixAll(0) })).toBeDisabled()
  })

  it("keeps notes across screens and navigates to their targets", () => {
    render(<ImprovementNotesPrototype />)
    addNote("Improve the primary action.")
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    addNote("Explain notifications.", "notifications")
    expect(fixAll(2)).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "View target: New project button" }))
    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute("aria-current", "page")
    expect(
      screen.getByRole("button", { name: "Open improvement note 1: New project button" }),
    ).toBeVisible()
  })

  it("captures an immutable batch and leaves later notes for the next batch", () => {
    render(<ImprovementNotesPrototype />)
    addNote("First requested improvement.")
    fireEvent.click(fixAll(1))
    const handoff = screen.getByRole("dialog", { name: copy.handoff })
    expect(within(handoff).getByText("First requested improvement.")).toBeVisible()
    fireEvent.click(within(handoff).getByRole("button", { name: copy.closeHandoff }))
    addNote("Second requested improvement.")
    expect(fixAll(1)).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "View demo batch (1)" }))
    expect(
      within(screen.getByRole("dialog", { name: copy.handoff })).queryByText(
        "Second requested improvement.",
      ),
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole("dialog", { name: copy.handoff })).getByRole("button", {
        name: copy.complete,
      }),
    )
    expect(fixAll(1)).toBeEnabled()
    expect(screen.getByText(copy.statuses.ready, { selector: "span" })).toBeVisible()
    expect(screen.getByText(copy.statuses.open)).toBeVisible()
  })

  it("requires author confirmation and supports reopening a resolved note", () => {
    render(<ImprovementNotesPrototype initial="single" />)
    fireEvent.click(fixAll(1))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: copy.handoff })).getByRole("button", {
        name: copy.complete,
      }),
    )
    expect(screen.getByText(copy.statuses.ready, { selector: "span" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.resolve }))
    expect(fixAll(0)).toBeDisabled()
    selectFilter(copy.resolvedFilter)
    fireEvent.click(screen.getByRole("button", { name: copy.reopen }))
    expect(fixAll(1)).toBeEnabled()
  })

  it("preserves unsaved text until the author explicitly discards it", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "New project button" }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
      target: { value: "Unfinished feedback" },
    })
    fireEvent.click(screen.getByRole("button", { name: copy.closeComposer }))
    fireEvent.click(screen.getByRole("button", { name: copy.keep }))
    expect(screen.getByRole("textbox", { name: copy.label })).toHaveValue("Unfinished feedback")
    fireEvent.click(screen.getByRole("button", { name: copy.closeComposer }))
    fireEvent.click(screen.getByRole("button", { name: copy.discard }))
    expect(screen.queryByRole("textbox", { name: copy.label })).not.toBeInTheDocument()
    expect(fixAll(0)).toBeDisabled()
  })

  it("ignores an old batch result after a sent note is edited", () => {
    render(<ImprovementNotesPrototype initial="single" />)
    fireEvent.click(fixAll(1))
    fireEvent.click(screen.getByRole("button", { name: copy.closeHandoff }))
    fireEvent.click(screen.getByRole("button", { name: copy.editAction }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
      target: { value: "Revised request" },
    })
    fireEvent.click(screen.getByRole("button", { name: copy.saveEdit }))
    expect(screen.getByText(copy.statuses.open)).toBeVisible()
    expect(fixAll(1)).toBeEnabled()
  })

  it("retains notes during simulated sync failure and allows retry", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.change(screen.getByLabelText(copy.syncControls), { target: { value: "failed" } })
    addNote("Keep this note when sync fails.")
    expect(screen.getByText("Keep this note when sync fails.")).toBeVisible()
    expect(screen.getByText(copy.sync.failed)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.syncRetry }))
    expect(screen.getByText(copy.sync.synced)).toBeVisible()
    expect(fixAll(1)).toBeEnabled()
  })

  it("supports region selection with a keyboard without dragging", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    fireEvent.keyDown(screen.getByLabelText("Selectable preview"), { key: "Enter", shiftKey: true })
    const stage = screen.getByRole("button", { name: "Choose region corners" })
    fireEvent.keyDown(stage, { key: "Enter" })
    fireEvent.keyDown(stage, { key: "ArrowRight" })
    fireEvent.keyDown(stage, { key: "ArrowDown" })
    fireEvent.keyDown(stage, { key: "Enter" })
    expect(screen.getByRole("dialog", { name: copy.add })).toBeVisible()
    expect(screen.queryByText("Selected region")).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
      target: { value: "Improve the keyboard-selected area." },
    })
    fireEvent.click(screen.getByRole("button", { name: copy.save }))
    expect(screen.getByText("Selected region")).toBeVisible()
  })

  it("shows blocked results without claiming the note is fixed", () => {
    render(<ImprovementNotesPrototype initial="single" />)
    fireEvent.click(fixAll(1))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: copy.handoff })).getByRole("button", {
        name: copy.block,
      }),
    )
    expect(screen.getByText(copy.statuses.blocked)).toBeVisible()
    expect(screen.queryByRole("button", { name: copy.resolve })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: copy.retryFix }))
    expect(fixAll(1)).toBeEnabled()
  })

  it("only deletes a saved note after confirmation", () => {
    render(<ImprovementNotesPrototype initial="single" />)
    fireEvent.click(screen.getByRole("button", { name: copy.deleteAction }))
    fireEvent.click(screen.getByRole("button", { name: copy.cancel }))
    expect(fixAll(1)).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: copy.deleteAction }))
    fireEvent.click(
      within(screen.getByRole("dialog", { name: copy.deleteTitle })).getByRole("button", {
        name: copy.deleteAction,
      }),
    )
    expect(fixAll(0)).toBeDisabled()
  })

  it("clicks an actual target and crops exactly its element bounds", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    const stage = pointerStage()
    const target = screen.getByRole("button", { name: "New project button" })
    fireEvent.pointerDown(target, { button: 0, clientX: 780, clientY: 60 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.pointerUp(stage, { clientX: 780, clientY: 60 })
    expect(within(screen.getByRole("dialog", { name: copy.add })).queryByRole("img")).toBeNull()
    fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
      target: { value: "Improve the selected action." },
    })
    fireEvent.click(screen.getByRole("button", { name: copy.save }))
    const image = screen.getByRole("img", { name: "Captured target: New project button" })
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain('viewBox="764 42 156 42"')
  })

  it("draws a rectangle in reverse and saves the exact normalized region", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    const stage = pointerStage()
    fireEvent.pointerDown(stage, { button: 0, clientX: 400, clientY: 300 })
    fireEvent.pointerMove(stage, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(stage, { clientX: 100, clientY: 100 })
    expect(within(screen.getByRole("dialog", { name: copy.add })).queryByRole("img")).toBeNull()
    fireEvent.change(screen.getByRole("textbox", { name: copy.label }), {
      target: { value: "Improve this whole area." },
    })
    fireEvent.click(screen.getByRole("button", { name: copy.save }))
    const image = screen.getByRole("img", { name: "Captured target: Selected region" })
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(
      'viewBox="100 100 300 200"',
    )
    expect(
      screen.getByRole("button", { name: "Open improvement note 1: Selected region" }),
    ).toBeVisible()
  })

  it("rejects a seven-pixel region and aborts a cancelled pointer gesture", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    const stage = pointerStage()
    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(stage, { clientX: 107, clientY: 107 })
    expect(screen.getByRole("status")).toHaveTextContent(copy.regionSmall)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage, { clientX: 400, clientY: 300 })
    fireEvent.pointerCancel(stage)
    fireEvent.pointerUp(stage, { clientX: 400, clientY: 300 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(stage, { clientX: 108, clientY: 108 })
    expect(screen.getByRole("dialog", { name: copy.add })).toBeVisible()
  })

  it("completes a two-corner region on pointer release, not pointer down", () => {
    render(<ImprovementNotesPrototype />)
    fireEvent.click(
      within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
        name: copy.annotate,
      }),
    )
    const stage = pointerStage()
    fireEvent.keyDown(stage, { key: "Enter", shiftKey: true })
    fireEvent.pointerDown(stage, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(stage, { clientX: 100, clientY: 100 })
    fireEvent.pointerDown(stage, { button: 0, clientX: 400, clientY: 300 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.pointerUp(stage, { clientX: 400, clientY: 300 })
    expect(screen.getByRole("dialog", { name: copy.add })).toBeVisible()
  })

  it("supports mixed per-note outcomes without resolving either note", () => {
    render(<ImprovementNotesPrototype initial="multiple" />)
    fireEvent.click(fixAll(2))
    fireEvent.click(screen.getByRole("button", { name: copy.closeHandoff }))
    const first = within(screen.getByRole("article", { name: "Improvement note 1" }))
    const second = within(screen.getByRole("article", { name: "Improvement note 2" }))
    fireEvent.click(first.getByText(copy.perNoteResult))
    fireEvent.click(first.getByRole("button", { name: copy.complete }))
    fireEvent.click(second.getByText(copy.perNoteResult))
    fireEvent.click(second.getByRole("button", { name: copy.block }))
    expect(first.getByText(copy.statuses.ready)).toBeVisible()
    expect(second.getByText(copy.statuses.blocked)).toBeVisible()
    expect(screen.queryByText(copy.statuses.resolved, { selector: "span" })).not.toBeInTheDocument()
  })

  it("exits annotation mode with Escape from the toolbar", () => {
    render(<ImprovementNotesPrototype />)
    const button = within(screen.getByRole("group", { name: copy.title })).getByRole("button", {
      name: copy.annotate,
    })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: "Escape" })
    expect(button).toHaveAttribute("aria-pressed", "false")
    expect(screen.queryByRole("button", { name: "New project button" })).not.toBeInTheDocument()
  })
})
