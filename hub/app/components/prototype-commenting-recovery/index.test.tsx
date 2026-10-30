import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { CommentingRecovery } from "."

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true
    },
  })
})

describe("CommentingRecovery()", () => {
  it("uses the shared dialog with the short copy and only fix and dismiss actions", () => {
    const onFix = vi.fn()
    const onDismiss = vi.fn()
    const returnFocus = document.createElement("button")
    document.body.append(returnFocus)
    returnFocus.focus()
    const view = render(
      <ThemeProvider>
        <CommentingRecovery busy={false} requested={false} onFix={onFix} onDismiss={onDismiss} />
      </ThemeProvider>,
    )
    const dialog = screen.getByRole("dialog", { name: "Commenting needs attention" })
    expect(dialog).toHaveClass("canvas-dialog")
    expect(screen.getByRole("button", { name: "Close commenting dialog" })).toHaveClass(
      "hub-icon-button",
    )
    expect(dialog).toHaveAccessibleDescription(
      "The canvas could not connect to the preview's commenting bridge.",
    )
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()
    expect(onFix).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Fix with Copilot" }))
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onFix).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
    fireEvent(dialog, new Event("cancel", { cancelable: true }))
    expect(onDismiss).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole("button", { name: "Close commenting dialog" }))
    expect(onDismiss).toHaveBeenCalledTimes(3)
    view.unmount()
    expect(returnFocus).toHaveFocus()
    returnFocus.remove()
  })

  it("reports a failed Copilot request without replacing the explanatory copy", () => {
    render(
      <ThemeProvider>
        <CommentingRecovery
          busy={false}
          requested={false}
          error="Could not reach Copilot."
          onFix={() => {}}
          onDismiss={() => {}}
        />
      </ThemeProvider>,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach Copilot.")
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "The canvas could not connect to the preview's commenting bridge.",
    )
  })
})
