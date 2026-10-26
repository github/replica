import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useEmojiBurst } from "."

describe("useEmojiBurst()", () => {
  let burst: ReturnType<typeof useEmojiBurst>["burst"]

  function BurstTest() {
    const effect = useEmojiBurst()
    burst = effect.burst
    return effect.canvas
  }

  it("draws four particles at the supplied viewport point and removes the canvas afterward", () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback)
        return frames.length
      }),
    )
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    vi.spyOn(Math, "random").mockReturnValue(0)
    const context: Partial<CanvasRenderingContext2D> = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      globalAlpha: 1,
      font: "",
      textAlign: "center",
      textBaseline: "middle",
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as CanvasRenderingContext2D,
    )
    render(<BurstTest />)

    act(() => burst("👍", 75, 90))
    expect(document.querySelector(".review-emoji-burst")).toHaveAttribute("aria-hidden", "true")
    expect(context.setTransform).toHaveBeenCalledWith(
      window.devicePixelRatio || 1,
      0,
      0,
      window.devicePixelRatio || 1,
      0,
      0,
    )

    const now = performance.now() + 1_000
    act(() => frames.shift()?.(now))
    expect(context.drawImage).toHaveBeenCalledTimes(4)
    expect(context.fillText).toHaveBeenCalledWith("👍", 9, 9)

    for (let index = 0; index < 40; index += 1) {
      act(() => frames.shift()?.(now + index * 16))
    }
    expect(document.querySelector(".review-emoji-burst")).not.toBeInTheDocument()
  })

  it("does not mount a canvas when reduced motion is preferred", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    )
    render(<BurstTest />)

    act(() => burst("🎉", 75, 90))

    expect(document.querySelector(".review-emoji-burst")).not.toBeInTheDocument()
  })
})
