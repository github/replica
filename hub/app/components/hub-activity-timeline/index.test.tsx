import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubActivityTimeline } from "."

describe("HubActivityTimeline()", () => {
  it("renders chronological events with machine-readable times", () => {
    const { container } = render(
      <HubActivityTimeline
        aria-label="Build activity"
        items={[
          { id: "created", dateTime: "2026-09-22T10:00:00Z", label: "Queued" },
          { id: "done", dateTime: "2026-09-22T10:01:00Z", label: "Published" },
        ]}
      />,
    )

    expect(screen.getByRole("list", { name: "Build activity" }).tagName).toBe("UL")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(Array.from(container.querySelectorAll("time")).map((time) => time.dateTime)).toEqual([
      "2026-09-22T10:00:00Z",
      "2026-09-22T10:01:00Z",
    ])
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Queued",
      "Published",
    ])
    expect(container.querySelector("svg")).not.toBeInTheDocument()
  })
})
