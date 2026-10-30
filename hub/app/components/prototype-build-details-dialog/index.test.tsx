import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ThemeProvider } from "@primer/react-brand"
import { createRef, useState } from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import type { PrototypeState } from "@utils/prototype-canvas/types"
import { BuildDetailsDialog } from "."

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true
    },
  })
})

const state: PrototypeState = {
  name: "Example",
  sessionId: "session-123",
  stats: {
    branch: "prototype/welcome",
    comparison: { branch: "main", source: "local", behind: 0, error: null },
  },
}

function renderDialog(dialogState = state) {
  return render(
    <ThemeProvider colorMode="auto">
      <BuildDetailsDialog
        state={dialogState}
        titleButtonRef={createRef()}
        onClose={() => undefined}
      />
    </ThemeProvider>,
  )
}

describe("BuildDetailsDialog()", () => {
  it("shows the real branch, session ID, and explicitly local comparison", () => {
    renderDialog()
    expect(screen.getByRole("dialog", { name: "Build details" })).toHaveAttribute("open")
    expect(screen.getByRole("dialog")).toHaveClass("canvas-dialog")
    expect(screen.getByRole("button", { name: "Close build details" })).toHaveClass(
      "hub-icon-button",
    )
    const branch = screen.getByText("prototype/welcome")
    expect(branch).toBeInTheDocument()
    expect(branch.closest("dd")?.querySelector(".octicon-git-branch")).toBeInTheDocument()
    expect(screen.getByText("session-123")).toBeInTheDocument()
    expect(screen.getByText("Behind main (local)")).toBeInTheDocument()
    expect(screen.getByText("Up to date")).toBeInTheDocument()
    expect(screen.queryByText("Overlay build")).not.toBeInTheDocument()
  })

  it("shows upstream comparison and errors without inventing a value", () => {
    const { rerender } = renderDialog({
      ...state,
      stats: {
        ...state.stats,
        comparison: { branch: "origin/main", source: "upstream", behind: 2, error: null },
      },
    })
    expect(screen.getByText("Behind origin/main")).toBeInTheDocument()
    expect(screen.getByText("2 commits behind")).toBeInTheDocument()

    rerender(
      <ThemeProvider colorMode="auto">
        <BuildDetailsDialog
          state={{
            ...state,
            sessionId: undefined,
            stats: {
              comparison: {
                branch: null,
                source: null,
                behind: null,
                error: "No upstream or local main branch is available.",
              },
            },
          }}
          titleButtonRef={createRef()}
          onClose={() => undefined}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText("No upstream or local main branch is available.")).toBeInTheDocument()
    expect(screen.getAllByText("Unavailable")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Copy session ID" })).not.toBeInTheDocument()
  })

  it("copies only branch and session ID, announcing success and failure", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Denied"))
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Copy branch" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Branch copied" })).toBeInTheDocument(),
    )
    expect(writeText).toHaveBeenCalledWith("prototype/welcome")

    fireEvent.click(screen.getByRole("button", { name: "Copy session ID" }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Session ID could not be copied"),
    )
    expect(writeText).toHaveBeenCalledWith("session-123")
    expect(screen.queryByRole("button", { name: "Branch copied" })).not.toBeInTheDocument()
  })

  it("closes on Escape or backdrop and restores focus to the title", () => {
    function DialogWithTrigger() {
      const [open, setOpen] = useState(true)
      const buttonRef = createRef<HTMLButtonElement>()
      return (
        <ThemeProvider colorMode="auto">
          <button ref={buttonRef} onClick={() => setOpen(true)}>
            prototype/welcome
          </button>
          {open && (
            <BuildDetailsDialog
              state={state}
              titleButtonRef={buttonRef}
              onClose={() => setOpen(false)}
            />
          )}
        </ThemeProvider>
      )
    }

    render(<DialogWithTrigger />)
    const trigger = screen.getByRole("button", { name: "prototype/welcome" })
    let dialog = screen.getByRole("dialog", { name: "Build details" })
    const focus = trigger.focus.bind(trigger)
    vi.spyOn(trigger, "focus").mockImplementation(() => {
      expect(dialog).not.toHaveAttribute("open")
      focus()
    })
    fireEvent(dialog, new Event("cancel", { cancelable: true }))
    expect(screen.queryByRole("dialog", { name: "Build details" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "prototype/welcome" })).toHaveFocus()

    fireEvent.click(screen.getByRole("button", { name: "prototype/welcome" }))
    dialog = screen.getByRole("dialog", { name: "Build details" })
    fireEvent.click(dialog, { clientX: 1000 })
    expect(screen.queryByRole("dialog", { name: "Build details" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "prototype/welcome" })).toHaveFocus()
  })
})
