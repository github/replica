import { act, render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ReviewRelativeTime } from "."

describe("ReviewRelativeTime()", () => {
  it("can omit the native title while keeping the full accessible date", () => {
    render(<ReviewRelativeTime value="2026-09-14T12:00:00Z" showTitle={false} />)
    expect(screen.getByRole("time")).not.toHaveAttribute("title")
    expect(screen.getByRole("time")).toHaveAttribute("aria-label", "Mon, 14 Sep 2026 12:00:00 GMT")
  })

  it("renders the same full date on the server regardless of the current time", () => {
    const first = renderToString(<ReviewRelativeTime value="2026-09-14T12:00:00Z" />)
    expect(first).toContain("Mon, 14 Sep 2026 12:00:00 GMT")
    expect(first).toContain('dateTime="2026-09-14T12:00:00Z"')
  })

  it("shows compact elapsed time while retaining the full accessible date", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T15:00:00Z"))
    render(<ReviewRelativeTime value="2026-09-14T12:00:00Z" />)

    const date = screen.getByRole("time")
    expect(date).toHaveTextContent("3h ago")
    expect(date).toHaveAttribute("title", "Mon, 14 Sep 2026 12:00:00 GMT")
    expect(date).toHaveAttribute("aria-label", "Mon, 14 Sep 2026 12:00:00 GMT")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(date).toHaveTextContent("3h ago")
  })
})
