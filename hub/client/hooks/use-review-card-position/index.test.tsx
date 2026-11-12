import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AnchorPoint, AnchorRectangle } from "@utils/review-anchor/types"

import { useReviewCardPosition } from "."

function PositionProbe({
  anchorRectangle,
  anchorPoint = { x: 700, y: 300 },
  layoutKey = "test",
  preserveVerticalSide = false,
}: {
  anchorRectangle?: AnchorRectangle
  anchorPoint?: AnchorPoint
  layoutKey?: string
  preserveVerticalSide?: boolean
}) {
  const { cardRef, position } = useReviewCardPosition({
    anchorPoint,
    ...(anchorRectangle ? { anchorRectangle } : {}),
    layoutKey,
    preserveVerticalSide,
  })

  return (
    <div data-position-container>
      <section
        ref={cardRef}
        data-testid="position-card"
        data-position-card
        style={{ left: position.left, top: position.top }}
      />
    </div>
  )
}

describe("useReviewCardPosition()", () => {
  it("places a card outside the anchor rectangle when the left side fits", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-card") ? 384 : 0
    })
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-card") ? 512 : 0
    })
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-container") ? 1_100 : 0
    })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-container") ? 760 : 0
    })

    render(
      <PositionProbe
        anchorRectangle={{
          x: 450,
          y: 200,
          width: 350,
          height: 400,
        }}
      />,
    )

    expect(screen.getByTestId("position-card")).toHaveStyle({
      left: "54px",
      top: "200px",
    })
  })

  it("keeps a composer below its anchor as confirmation changes its height", () => {
    let cardHeight = 247
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-card") ? 320 : 0
    })
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-card") ? cardHeight : 0
    })
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-container") ? 832 : 0
    })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute("data-position-container") ? 512 : 0
    })
    const { rerender } = render(
      <PositionProbe anchorPoint={{ x: 360, y: 180 }} layoutKey="draft" preserveVerticalSide />,
    )
    expect(screen.getByTestId("position-card")).toHaveStyle({ top: "192px" })

    cardHeight = 323
    rerender(
      <PositionProbe
        anchorPoint={{ x: 360, y: 180 }}
        layoutKey="confirmation"
        preserveVerticalSide
      />,
    )
    expect(screen.getByTestId("position-card")).toHaveStyle({ top: "181px" })
  })
})
