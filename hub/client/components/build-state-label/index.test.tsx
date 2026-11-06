import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BuildStateLabel } from "."
vi.mock("@primer/react-brand", () => ({
  Label: ({ children, color }: { children: string; color: string }) => (
    <span data-color={color}>{children}</span>
  ),
}))

describe("BuildStateLabel()", () => {
  it("maps every persisted build state to its label color", () => {
    render(
      <>
        <BuildStateLabel state="queued" label="Queued" />
        <BuildStateLabel state="running" label="Running" />
        <BuildStateLabel state="failed" label="Failed" />
        <BuildStateLabel state="superseded" label="Superseded" />
        <BuildStateLabel state="successful" label="Successful" />
      </>,
    )

    expect(screen.getByText("Queued")).toHaveAttribute("data-color", "gray")
    expect(screen.getByText("Running")).toHaveAttribute("data-color", "orange")
    expect(screen.getByText("Failed")).toHaveAttribute("data-color", "red")
    expect(screen.getByText("Superseded")).toHaveAttribute("data-color", "default")
    expect(screen.getByText("Successful")).toHaveAttribute("data-color", "green")
  })
})
