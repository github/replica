import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LearningActivityGrid } from "."

describe("LearningActivityGrid()", () => {
  it("shows the selected day's run and moves between days with the arrow keys", () => {
    render(
      <ThemeProvider>
        <LearningActivityGrid
          today="2026-11-20"
          activity={[
            {
              date: "2026-11-18",
              runState: "failed",
              startedAt: "2026-11-18T16:30:00Z",
              startedBy: "@mona",
              commentsAnalyzed: 3,
              commentsTagged: 0,
              suggestions: 0,
            },
            {
              date: "2026-11-19",
              runState: "succeeded",
              startedAt: "2026-11-19T16:30:00Z",
              startedBy: "the daily schedule",
              commentsAnalyzed: 12,
              commentsTagged: 4,
              suggestions: 2,
            },
          ]}
        />
      </ThemeProvider>,
    )
    const calendar = screen.getByRole("group", { name: "Daily learning activity for 2026" })

    // Days still ahead are not buttons, so only Jan 1 through today can be chosen.
    expect(within(calendar).getAllByRole("button")).toHaveLength(324)
    expect(screen.getByText(/Run completed · Started by the daily schedule/)).toBeVisible()
    expect(screen.getByText("Suggestions", { selector: "dt" }).parentElement).toHaveTextContent("2")

    const latest = within(calendar).getByRole("button", { name: /^November 19, 2026,/ })
    fireEvent.keyDown(latest, { key: "ArrowUp" })
    expect(document.activeElement).toHaveAccessibleName(/^November 18, 2026,.*run failed$/)
    expect(screen.getByText(/Run failed · Started by @mona/)).toBeVisible()

    const today = within(calendar).getByRole("button", { name: /^November 20, 2026,/ })
    fireEvent.click(today)
    // Tomorrow has no square, so the selection stays on today.
    fireEvent.keyDown(today, { key: "ArrowDown" })
    expect(today).toHaveAttribute("aria-pressed", "true")
    expect(today).toHaveAccessibleName(/no run$/)
    expect(screen.getByText("No learning run")).toBeVisible()
  })
  it("selects the latest day of the new year when the page stays open over New Year", () => {
    const day = {
      runState: "succeeded" as const,
      startedAt: "2026-12-30T16:30:00Z",
      startedBy: "the daily schedule",
      commentsAnalyzed: 5,
      commentsTagged: 1,
      suggestions: 0,
    }
    const { rerender } = render(
      <ThemeProvider>
        <LearningActivityGrid today="2026-12-31" activity={[{ ...day, date: "2026-12-30" }]} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: /^December 30, 2026,/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    rerender(
      <ThemeProvider>
        <LearningActivityGrid today="2027-01-01" activity={[]} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: /^January 1, 2027,/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByText("No learning run")).toBeVisible()
  })
})
