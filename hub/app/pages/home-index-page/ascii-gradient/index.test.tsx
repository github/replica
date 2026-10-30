import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AsciiGradient } from "."

const LABELS = { pauseLabel: "Pause animation", resumeLabel: "Resume animation" }

type CanvasFill = {
  color: string
  pixels: string
}

type CanvasState = {
  backgroundColor: string | null
  clearRectCalls: number
  fills: CanvasFill[]
}

function mediaPreference(query: string, matches: boolean) {
  const listeners = new Set<() => void>()
  const preference = Object.assign(window.matchMedia(query), {
    matches,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  })

  return {
    preference,
    listeners,
    change(matches: boolean) {
      preference.matches = matches
      for (const listener of listeners) listener()
    },
  }
}

describe("AsciiGradient()", () => {
  let reducedMotion: ReturnType<typeof mediaPreference>
  let hoverPointer: ReturnType<typeof mediaPreference>
  let canvasStates: WeakMap<HTMLCanvasElement, CanvasState>
  let frames: Map<number, FrameRequestCallback>
  let time: number
  const requestFrame = vi.fn<(callback: FrameRequestCallback) => number>()
  const cancelFrame = vi.fn<(id: number) => void>()

  beforeEach(() => {
    reducedMotion = mediaPreference("(prefers-reduced-motion: reduce)", false)
    hoverPointer = mediaPreference("(hover: hover) and (pointer: fine)", true)
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      query === reducedMotion.preference.media ? reducedMotion.preference : hoverPointer.preference,
    )
    vi.spyOn(document, "hidden", "get").mockReturnValue(false)
    canvasStates = new WeakMap()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      contextId: string,
    ) {
      if (contextId !== "2d") return null

      let currentPixels: string[] = []
      const state: CanvasState = {
        backgroundColor: null,
        clearRectCalls: 0,
        fills: [],
      }
      const context = {
        fillStyle: "",
        clearRect() {
          state.clearRectCalls++
          state.fills = []
        },
        fillRect() {
          state.backgroundColor = context.fillStyle
        },
        beginPath() {
          currentPixels = []
        },
        rect(x: number, y: number, width: number, height: number) {
          if (width === 8 && height === 8) {
            currentPixels.push(`M${x} ${y}h8v8h-8z`)
          }
        },
        fill() {
          state.fills.push({
            color: context.fillStyle,
            pixels: currentPixels.join(""),
          })
        },
      }

      canvasStates.set(this, state)
      return context as unknown as CanvasRenderingContext2D
    } as HTMLCanvasElement["getContext"])
    frames = new Map()
    time = 0
    let frameId = 0
    requestFrame.mockImplementation((callback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    cancelFrame.mockImplementation((id) => {
      frames.delete(id)
    })
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(requestFrame)
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame)
  })

  function tick(elapsed = 16) {
    time += elapsed
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(time)
  }

  function advance(count = 120, elapsed = 16) {
    for (let index = 0; index < count; index++) tick(elapsed)
  }

  function move(artwork: Element, pointerType = "mouse", clientX = 800, clientY = 600) {
    vi.spyOn(artwork, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600))
    fireEvent(
      artwork,
      Object.assign(new MouseEvent("pointermove", { clientX, clientY, bubbles: true }), {
        pointerType,
      }),
    )
  }

  function changedPixels(artwork: Element) {
    const canvas = artwork.querySelector("canvas")
    const canvasState = canvas ? canvasStates.get(canvas) : undefined
    if (canvasState?.fills.length) {
      return canvasState.fills.map((fill) => fill.pixels).join("")
    }

    return [...artwork.querySelectorAll(".ascii-gradient__base, .ascii-gradient__highlights")]
      .map((path) => path.getAttribute("d"))
      .join("")
  }

  function canvasFills(artwork: Element) {
    const canvas = artwork.querySelector("canvas")
    return canvas ? (canvasStates.get(canvas)?.fills ?? []) : []
  }

  function canvasBackground(artwork: Element) {
    const canvas = artwork.querySelector("canvas")
    return canvas ? (canvasStates.get(canvas)?.backgroundColor ?? null) : null
  }

  it("keeps the deterministic square grid decorative and exposes a playback control", () => {
    const { container, rerender } = render(<AsciiGradient {...LABELS} className="home__art" />)
    const artwork = container.querySelector<HTMLElement>(".ascii-gradient")!
    const svg = artwork.querySelector("svg")!
    const path = svg.querySelector<SVGPathElement>(".ascii-gradient__base")!
    const highlights = svg.querySelector<SVGPathElement>(".ascii-gradient__highlights")!
    const canvas = artwork.querySelector("canvas")!
    const pixels = path.getAttribute("d")!
    const highlightPixels = highlights.getAttribute("d")!
    const squares = [...pixels.matchAll(/M(\d+) (\d+)h8v8h-8z/g)]
    const highlightSquares = [...highlightPixels.matchAll(/M(\d+) (\d+)h8v8h-8z/g)]
    const allSquares = [...squares, ...highlightSquares]
    const sparseLeft = allSquares.filter(([, x]) => Number(x) < 704)
    const solidRight = allSquares.filter(([, x]) => Number(x) >= 1376)
    const leftMix = allSquares.filter(([, x]) => Number(x) < 1024)
    const leftHighlights = highlightSquares.filter(([, x]) => Number(x) < 1024)
    const rightHighlights = highlightSquares.filter(([, x]) => Number(x) >= 1376)
    const rects = svg.querySelectorAll("rect")

    expect(artwork).toHaveClass("home__art")
    expect(artwork).not.toHaveAttribute("aria-hidden")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg).toHaveAttribute("focusable", "false")
    expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid slice")
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges")
    expect(rects).toHaveLength(1)
    expect(rects[0]).toHaveAttribute("fill", "#000000")
    expect(path).toHaveAttribute("fill", "#258B48")
    expect(highlights).toHaveAttribute("fill", "#47B966")
    expect(highlightSquares).toHaveLength(3163)
    expect(svg.querySelectorAll("path")).toHaveLength(2)
    expect(canvas).toHaveAttribute("width", "1536")
    expect(canvas).toHaveAttribute("height", "1024")
    expect(changedPixels(artwork)).toBe(`${pixels}${highlightPixels}`)
    expect(allSquares.length).toBeGreaterThan(8000)
    expect(solidRight.length).toBeGreaterThan(sparseLeft.length * 4)
    expect(leftHighlights.length / leftMix.length).toBeLessThan(0.1)
    expect(rightHighlights.length / solidRight.length).toBeGreaterThan(0.6)
    expect(pixels).toContain("M1264 512h8v8h-8z")
    expect(highlightPixels).not.toContain("M1264 512h8v8h-8z")
    expect(highlightPixels).toContain("M1520 512h8v8h-8z")
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument()
    expect(frames.size).toBe(1)

    rerender(
      <AsciiGradient
        {...LABELS}
        backgroundColor="#121613"
        className="another-class"
        controlBorderColor="#58635B"
        controlColor="#F2F5F3"
        highlightColor="#A4F4BC"
        pixelColor="#353D37"
      />,
    )
    expect(path).toHaveAttribute("d", pixels)
    expect(rects[0]).toHaveAttribute("fill", "#121613")
    expect(path).toHaveAttribute("fill", "#353D37")
    expect(highlights).toHaveAttribute("fill", "#A4F4BC")
    expect(artwork.style.getPropertyValue("--ascii-gradient-background")).toBe("#121613")
    expect(artwork.style.getPropertyValue("--ascii-gradient-control")).toBe("#F2F5F3")
    expect(artwork.style.getPropertyValue("--ascii-gradient-control-border")).toBe("#58635B")
    expect(artwork.style.getPropertyValue("--ascii-gradient-highlight")).toBe("#A4F4BC")
    expect(frames.size).toBe(1)
  })

  it("preserves the ordered Bayer pattern through the transition", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const pixels = [...container.querySelectorAll("path")]
      .map((path) => path.getAttribute("d"))
      .join("")
    const coordinates = new Set(
      [...pixels.matchAll(/M(\d+) (\d+)h8v8h-8z/g)].map(([, x, y]) => `${x},${y}`),
    )
    const tile = Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, column) =>
        coordinates.has(`${(column + 120) * 8},${row * 8}`) ? "1" : "0",
      ).join(""),
    )

    expect(tile).toEqual([
      "10101010",
      "01010101",
      "10101010",
      "01010101",
      "10101010",
      "01000101",
      "10101010",
      "00010101",
    ])
  })

  it("cycles palettes through a curved ordered wipe from the right", () => {
    const palettes = [
      { pixelColor: "#111111", highlightColor: "#222222" },
      { pixelColor: "#333333", highlightColor: "#444444" },
      { pixelColor: "#555555", highlightColor: "#666666" },
    ]
    const { container } = render(<AsciiGradient {...LABELS} palettes={palettes} />)
    const artwork = container.firstElementChild!
    const currentBase = artwork.querySelector(".ascii-gradient__base")!
    const currentHighlights = artwork.querySelector(".ascii-gradient__highlights")!

    expect(currentBase).toHaveAttribute("fill", "#111111")
    expect(currentHighlights).toHaveAttribute("fill", "#222222")
    expect(canvasFills(artwork)).toEqual([])

    advance(400, 32)

    const transitionFills = canvasFills(artwork)
    const nextCells = transitionFills
      .filter((fill) => fill.color === "#333333" || fill.color === "#444444")
      .map((fill) => fill.pixels)
      .join("")
    const nextColumns = [...nextCells.matchAll(/M(\d+) \d+h8v8h-8z/g)].map(([, x]) => Number(x))
    expect(nextColumns.length).toBeGreaterThan(0)
    expect(Math.min(...nextColumns)).toBeGreaterThan(1200)
    expect(Math.max(...nextColumns)).toBeGreaterThanOrEqual(1500)
    expect(transitionFills.map((fill) => fill.color)).toEqual(
      expect.arrayContaining(["#111111", "#222222", "#333333", "#444444"]),
    )

    advance(90, 32)

    const heldColors = canvasFills(artwork).map((fill) => fill.color)
    expect(heldColors).toEqual(expect.arrayContaining(["#333333", "#444444"]))
    expect(heldColors).not.toContain("#555555")
    expect(heldColors).not.toContain("#666666")
  })

  it("uses real frame time for palette timing while clamping spring integration", () => {
    const palettes = [
      { pixelColor: "#111111", highlightColor: "#222222" },
      { pixelColor: "#333333", highlightColor: "#444444" },
    ]
    const { container } = render(<AsciiGradient {...LABELS} palettes={palettes} />)
    const artwork = container.firstElementChild!

    tick()
    advance(13, 1000)

    expect(canvasFills(artwork).map((fill) => fill.color)).toEqual(
      expect.arrayContaining(["#333333", "#444444"]),
    )
    expect(changedPixels(artwork)).not.toMatch(/NaN|Infinity/)
  })

  it("shifts the density field without moving the pixel grid", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild! as HTMLElement
    const svg = artwork.querySelector("svg")!
    const baseline = svg.querySelector("path")!.getAttribute("d")

    advance()
    const firstShape = changedPixels(artwork)
    const cells = [...firstShape.matchAll(/M(\d+) (\d+)h8v8h-8z/g)]
    const rows = cells.map(([, , y]) => Number(y))
    expect(cells.length).toBeGreaterThan(8000)
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThan(560)

    advance(240)
    expect(changedPixels(artwork)).not.toBe(firstShape)
    expect(frames.size).toBe(1)
    expect(svg.style.transform).toBe("")
    expect(artwork.style.transform).toBe("")
    expect(svg.querySelector("path")).toHaveAttribute("d", baseline)
  })

  it("lets the pointer steer the ambient shape and returns to drifting on leave", () => {
    const { container } = render(
      <>
        <AsciiGradient {...LABELS} />
        <AsciiGradient {...LABELS} />
      </>,
    )
    const reference = container.children[0]!
    const artwork = container.children[1]!

    advance()
    expect(changedPixels(artwork)).toBe(changedPixels(reference))
    move(artwork, "mouse", 200, 100)
    move(artwork, "mouse", 200, 100)
    expect(frames.size).toBe(2)
    advance()
    expect(changedPixels(artwork)).not.toBe(changedPixels(reference))

    const steered = changedPixels(artwork)
    fireEvent.pointerLeave(artwork)
    expect(changedPixels(artwork)).toBe(steered)
    advance(300)
    expect(changedPixels(artwork)).toBe(changedPixels(reference))
    expect(frames.size).toBe(2)
  })

  it("extends pointer deformation through the right edge without crossing into the copy", () => {
    const { container } = render(
      <>
        <AsciiGradient {...LABELS} />
        <AsciiGradient {...LABELS} />
      </>,
    )
    const reference = container.children[0]!
    const artwork = container.children[1]!

    move(artwork, "mouse", 800, 300)
    advance()

    const referenceCells = new Set(changedPixels(reference).match(/M\d+ \d+h8v8h-8z/g))
    const artworkCells = new Set(changedPixels(artwork).match(/M\d+ \d+h8v8h-8z/g))
    const changed = [
      ...[...referenceCells].filter((cell) => !artworkCells.has(cell)),
      ...[...artworkCells].filter((cell) => !referenceCells.has(cell)),
    ]
    const columns = changed.map((cell) => Number(cell.match(/^M(\d+)/)![1]))

    expect(Math.min(...columns)).toBeGreaterThanOrEqual(768)
    expect(Math.max(...columns)).toBeGreaterThanOrEqual(1500)
  })

  it("freezes the current shape when paused and resumes without counting paused time", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    advance()
    const snapshot = changedPixels(artwork)

    const button = screen.getByRole("button", { name: "Pause animation" })
    fireEvent.click(button)
    expect(artwork).toHaveClass("ascii-gradient--paused")
    expect(screen.getByRole("button", { name: "Resume animation" })).toBe(button)
    expect(frames.size).toBe(0)
    move(artwork)
    tick(20_000)
    expect(changedPixels(artwork)).toBe(snapshot)

    fireEvent.click(button)
    expect(artwork).not.toHaveClass("ascii-gradient--paused")
    expect(frames.size).toBe(1)
    tick(20_000)
    const before = new Set(snapshot.match(/M\d+ \d+h8v8h-8z/g))
    const after = new Set(changedPixels(artwork).match(/M\d+ \d+h8v8h-8z/g))
    const changed =
      [...before].filter((cell) => !after.has(cell)).length +
      [...after].filter((cell) => !before.has(cell)).length
    expect(changed).toBeLessThan(100)
    advance()
    expect(changedPixels(artwork)).not.toBe(snapshot)
  })

  it("redraws theme changes while paused without resuming animation", () => {
    const { container, rerender } = render(
      <AsciiGradient
        {...LABELS}
        backgroundColor="#000000"
        palettes={[{ pixelColor: "#111111", highlightColor: "#222222" }]}
      />,
    )
    const artwork = container.firstElementChild!
    advance()
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }))

    rerender(
      <AsciiGradient
        {...LABELS}
        backgroundColor="#F2F5F3"
        palettes={[{ pixelColor: "#333333", highlightColor: "#444444" }]}
      />,
    )

    expect(artwork).toHaveClass("ascii-gradient--paused")
    expect(screen.getByRole("button", { name: "Resume animation" })).toBeInTheDocument()
    expect(frames.size).toBe(0)
    expect(canvasBackground(artwork)).toBe("#F2F5F3")
    expect(canvasFills(artwork).map(({ color }) => color)).toEqual(["#333333", "#444444"])
  })

  it("leaves reduced-motion artwork static, including mouse input", () => {
    reducedMotion.change(true)
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const snapshot = changedPixels(artwork)

    move(artwork)
    advance()
    expect(requestFrame).not.toHaveBeenCalled()
    expect(changedPixels(artwork)).toBe(snapshot)
  })

  it("does not let playback controls override reduced motion", () => {
    reducedMotion.change(true)
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const snapshot = changedPixels(artwork)

    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }))
    fireEvent.click(screen.getByRole("button", { name: "Resume animation" }))
    move(artwork)
    advance()

    expect(requestFrame).not.toHaveBeenCalled()
    expect(changedPixels(artwork)).toBe(snapshot)
  })

  it("checks reduced motion before painting a frame already scheduled", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const snapshot = changedPixels(artwork)
    advance()
    reducedMotion.preference.matches = true
    tick()

    expect(frames.size).toBe(0)
    expect(changedPixels(artwork)).toBe(snapshot)
  })

  it.each(["touch", "pen", "coarse mouse"])(
    "keeps ambient motion but ignores %s steering",
    (input) => {
      if (input === "coarse mouse") hoverPointer.change(false)
      const { container } = render(
        <>
          <AsciiGradient {...LABELS} />
          <AsciiGradient {...LABELS} />
        </>,
      )
      const reference = container.children[0]!
      const artwork = container.children[1]!

      move(artwork, input === "coarse mouse" ? "mouse" : input)
      advance()
      expect(changedPixels(artwork)).not.toBe("")
      expect(changedPixels(artwork)).toBe(changedPixels(reference))
      expect(frames.size).toBe(2)
    },
  )

  it("caps pixel redraws while continuing to integrate the spring between paints", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const canvas = artwork.querySelector("canvas")!
    const state = canvasStates.get(canvas)!

    tick()
    expect(state.clearRectCalls).toBe(1)
    tick(8)
    expect(state.clearRectCalls).toBe(1)
    tick(26)
    expect(state.clearRectCalls).toBe(2)
  })

  it("clamps delayed frames and pointer input without moving cells off the fixed grid", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!

    move(artwork, "mouse", 8000, 6000)
    tick()
    tick(10_000)
    advance()
    expect(artwork.querySelector("svg")!.style.transform).toBe("")
    expect(changedPixels(artwork)).not.toBe("")
    expect(changedPixels(artwork)).not.toMatch(/NaN|Infinity/)
    for (const [, x, y] of changedPixels(artwork).matchAll(/M(\d+) (\d+)h8v8h-8z/g)) {
      expect(Number(x)).toBeLessThan(1568)
      expect(Number(y)).toBeLessThan(1024)
      expect(Number(x) % 8).toBe(0)
      expect(Number(y) % 8).toBe(0)
    }
  })

  it("responds to runtime reduced motion and automatically resumes when permitted", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const initial = changedPixels(artwork)
    advance()
    reducedMotion.change(true)

    expect(cancelFrame).toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(changedPixels(artwork)).toBe(initial)
    move(artwork)
    expect(frames.size).toBe(0)

    reducedMotion.change(false)
    expect(frames.size).toBe(1)
    advance()
    expect(changedPixels(artwork)).not.toBe("")
  })

  it("suspends a hidden tab and resumes from the same shape when visible", () => {
    const { container } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    advance()
    const snapshot = changedPixels(artwork)

    vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    fireEvent(document, new Event("visibilitychange"))
    expect(frames.size).toBe(0)
    move(artwork)
    tick(20_000)
    expect(changedPixels(artwork)).toBe(snapshot)

    vi.spyOn(document, "hidden", "get").mockReturnValue(false)
    fireEvent(document, new Event("visibilitychange"))
    expect(frames.size).toBe(1)
    expect(changedPixels(artwork)).toBe(snapshot)
    advance()
    expect(changedPixels(artwork)).not.toBe(snapshot)
  })

  it("keeps an explicit pause through visibility and motion-preference changes", () => {
    render(<AsciiGradient {...LABELS} />)
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }))
    reducedMotion.change(true)
    reducedMotion.change(false)
    fireEvent(document, new Event("visibilitychange"))

    expect(frames.size).toBe(0)
    expect(screen.getByRole("button", { name: "Resume animation" })).toBeInTheDocument()
  })

  it("removes media, pointer, and visibility listeners and cancels its frame on unmount", () => {
    const removeVisibilityListener = vi.spyOn(document, "removeEventListener")
    const { container, unmount } = render(<AsciiGradient {...LABELS} />)
    const artwork = container.firstElementChild!
    const removePointerListener = vi.spyOn(artwork, "removeEventListener")

    unmount()

    expect(frames.size).toBe(0)
    expect(cancelFrame).toHaveBeenCalled()
    expect(reducedMotion.listeners.size).toBe(0)
    expect(hoverPointer.listeners.size).toBe(0)
    expect(removeVisibilityListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function))
    for (const event of ["pointermove", "pointerleave", "pointercancel"]) {
      expect(removePointerListener).toHaveBeenCalledWith(event, expect.any(Function))
    }
  })
})
