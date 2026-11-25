import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ImprovementSelectionDemo } from "."
import { copy } from "./en"
import { notes } from "./fixtures"

describe("ImprovementSelectionDemo()", () => {
  it("selects and deselects a note by clicking the visible checkbox", () => {
    render(<ImprovementSelectionDemo />)
    const checkbox = screen.getByRole("checkbox", { name: copy.select(notes[0]!.body) })
    // Brand forwards clicks on its visible box to the visually hidden input.
    const visibleBox = checkbox.nextElementSibling!

    fireEvent.click(visibleBox)

    expect(checkbox).toBeChecked()
    const footer = screen.getByRole("region", { name: copy.selection })
    expect(within(footer).getByRole("button", { name: "Fix selected 1" })).toBeVisible()
    expect(within(footer).queryByRole("button", { name: /Mark as resolved/ })).toBeNull()

    fireEvent.click(visibleBox)

    expect(checkbox).not.toBeChecked()
    expect(screen.queryByRole("region", { name: copy.selection })).toBeNull()
  })

  it.each(["fix", "resolve"])(
    "applies only the eligible selected notes when choosing %s first",
    (first) => {
      render(<ImprovementSelectionDemo />)
      const open = notes[0]!
      const ready = notes[1]!
      const untouched = notes[2]!
      fireEvent.click(screen.getByRole("checkbox", { name: copy.select(open.body) }))
      fireEvent.click(screen.getByRole("checkbox", { name: copy.select(ready.body) }))
      const footer = screen.getByRole("region", { name: copy.selection })
      expect(within(footer).getByRole("status")).toHaveTextContent(copy.selected(2))
      const fix = within(footer).getByRole("button", { name: /Fix selected/ })
      const resolve = within(footer).getByRole("button", { name: /Mark as resolved/ })
      expect(fix).toHaveAccessibleName("Fix selected 1")
      expect(resolve).toHaveAccessibleName("Mark as resolved 1")

      fireEvent.click(first === "fix" ? fix : resolve)

      expect(within(footer).getByRole("status")).toHaveTextContent(copy.selected(1))
      const untouchedCard = screen.getByRole("article", { name: untouched.body })
      expect(within(untouchedCard).queryByText(copy.ready)).not.toBeInTheDocument()
      expect(screen.getByRole("checkbox", { name: copy.select(untouched.body) })).not.toBeChecked()
      if (first === "fix") {
        expect(
          within(screen.getByRole("article", { name: open.body })).getByText(copy.ready),
        ).toBeVisible()
        expect(within(footer).queryByRole("button", { name: /Fix selected/ })).toBeNull()
        expect(screen.getByRole("checkbox", { name: copy.select(ready.body) })).toBeChecked()
        fireEvent.click(resolve)
      } else {
        expect(screen.queryByRole("article", { name: ready.body })).not.toBeInTheDocument()
        expect(within(footer).queryByRole("button", { name: /Mark as resolved/ })).toBeNull()
        expect(screen.getByRole("checkbox", { name: copy.select(open.body) })).toBeChecked()
        fireEvent.click(fix)
      }

      expect(screen.queryByRole("region", { name: copy.selection })).toBeNull()
      expect(screen.queryByRole("article", { name: ready.body })).not.toBeInTheDocument()
      expect(
        within(screen.getByRole("article", { name: open.body })).getByText(copy.ready),
      ).toBeVisible()
      expect(within(untouchedCard).queryByText(copy.ready)).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: copy.simulate(1) })).toBeEnabled()
    },
  )

  it("clears selection explicitly and when leaving Active without changing notes", () => {
    render(<ImprovementSelectionDemo />)
    const note = notes[0]!
    const checkbox = screen.getByRole("checkbox", { name: copy.select(note.body) })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole("button", { name: copy.clear }))
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByRole("region", { name: copy.selection })).toBeNull()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: copy.ready }))
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: copy.selection })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: copy.allActive }))
    expect(screen.getByRole("checkbox", { name: copy.select(note.body) })).not.toBeChecked()
    expect(screen.getByRole("button", { name: copy.simulate(2) })).toBeEnabled()
  })
})
